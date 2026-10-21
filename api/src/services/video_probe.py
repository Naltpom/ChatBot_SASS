"""Lecture minimale d'un fichier vidéo (format + durée), sans dépendance.

Sert à valider côté serveur une vidéo AVANT de l'envoyer à TikTok (format
pris en charge, durée max du créateur). On ne décode rien : on lit seulement
les en-têtes de conteneur.

- MP4 / MOV (ISO BMFF) : boîtes de premier niveau parcourues par taille
  (`moov` peut être en fin de fichier) ; durée = `moov/mvhd` duration / timescale.
- WebM (Matroska/EBML) : DocType `webm`, puis Segment > Info >
  TimecodeScale (défaut 1 ms) x Duration.

Tout fichier non reconnu ou dont la durée est illisible lève `ProbeError`.
"""
import struct
from dataclasses import dataclass
from typing import BinaryIO, Optional


class ProbeError(ValueError):
    pass


@dataclass
class VideoInfo:
    mime_type: str          # video/mp4 | video/quicktime | video/webm
    duration_sec: float


# Boîtes de premier niveau acceptées en tête de fichier ISO BMFF (MOV ancien
# sans ftyp : commence souvent par wide/mdat/moov/free).
_BMFF_HEAD = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}
_MAX_BOXES = 10_000


def probe(path: str) -> VideoInfo:
    with open(path, "rb") as f:
        head = f.read(12)
        if len(head) >= 8 and head[4:8] in _BMFF_HEAD:
            return _probe_bmff(f)
        if head[:4] == b"\x1a\x45\xdf\xa3":
            return _probe_webm(f)
    raise ProbeError("Format non reconnu (MP4, MOV ou WebM attendu)")


# --------------------------------------------------------------------------
# ISO BMFF (MP4 / MOV)
# --------------------------------------------------------------------------

def _boxes(f: BinaryIO, start: int, end: int):
    """(type, début du contenu, fin de la boîte) des boîtes de [start, end)."""
    pos, n = start, 0
    while pos + 8 <= end and n < _MAX_BOXES:
        n += 1
        f.seek(pos)
        hdr = f.read(8)
        if len(hdr) < 8:
            return
        size, kind = struct.unpack(">I4s", hdr)
        body = pos + 8
        if size == 1:                       # taille 64 bits
            ext = f.read(8)
            if len(ext) < 8:
                return
            size = struct.unpack(">Q", ext)[0]
            body = pos + 16
        elif size == 0:                     # jusqu'à la fin du conteneur
            size = end - pos
        if size < body - pos:
            raise ProbeError("Fichier vidéo corrompu (boîte invalide)")
        yield kind, body, min(pos + size, end)
        pos += size


def _probe_bmff(f: BinaryIO) -> VideoInfo:
    f.seek(0, 2)
    file_end = f.tell()
    mime = "video/mp4"
    duration: Optional[float] = None
    for kind, body, box_end in _boxes(f, 0, file_end):
        if kind == b"ftyp":
            f.seek(body)
            if f.read(4) == b"qt  ":
                mime = "video/quicktime"
        elif kind == b"moov":
            for sub, sbody, _ in _boxes(f, body, box_end):
                if sub == b"mvhd":
                    duration = _mvhd_duration(f, sbody)
                    break
            break
    if duration is None:
        raise ProbeError("Durée de la vidéo illisible (en-tête moov/mvhd absent)")
    return VideoInfo(mime, duration)


def _mvhd_duration(f: BinaryIO, body: int) -> float:
    f.seek(body)
    version = f.read(4)[0]
    if version == 1:
        data = f.read(28)       # creation(8) modification(8) timescale(4) duration(8)
        if len(data) < 28:
            raise ProbeError("En-tête mvhd tronqué")
        timescale, duration = struct.unpack(">IQ", data[16:28])
    else:
        data = f.read(16)       # creation(4) modification(4) timescale(4) duration(4)
        if len(data) < 16:
            raise ProbeError("En-tête mvhd tronqué")
        timescale, duration = struct.unpack(">II", data[8:16])
    if not timescale:
        raise ProbeError("Durée de la vidéo illisible (timescale nul)")
    return duration / timescale


# --------------------------------------------------------------------------
# WebM (EBML)
# --------------------------------------------------------------------------

_EBML = 0x1A45DFA3
_DOCTYPE = 0x4282
_SEGMENT = 0x18538067
_INFO = 0x1549A966
_TIMECODE_SCALE = 0x2AD7B1
_DURATION = 0x4489
_CLUSTER = 0x1F43B675


def _vint(f: BinaryIO, keep_marker: bool) -> tuple[int, int, bool]:
    """(valeur, longueur, inconnue) d'un entier EBML de taille variable."""
    b = f.read(1)
    if not b:
        raise ProbeError("Fichier WebM tronqué")
    first = b[0]
    length = 1
    while length <= 8 and not first & (0x80 >> (length - 1)):
        length += 1
    if length > 8:
        raise ProbeError("Fichier WebM corrompu")
    value = first if keep_marker else first & (0xFF >> length)
    rest = f.read(length - 1)
    if len(rest) < length - 1:
        raise ProbeError("Fichier WebM tronqué")
    for c in rest:
        value = (value << 8) | c
    unknown = not keep_marker and value == (1 << (7 * length)) - 1
    return value, length, unknown


def _elements(f: BinaryIO, start: int, end: int):
    pos, n = start, 0
    while pos < end and n < _MAX_BOXES:
        n += 1
        f.seek(pos)
        eid, il, _ = _vint(f, keep_marker=True)
        size, sl, unknown = _vint(f, keep_marker=False)
        body = pos + il + sl
        stop = end if unknown else min(body + size, end)
        yield eid, body, stop, unknown
        if unknown:
            return
        pos = body + size


def _read_uint(f: BinaryIO, body: int, end: int) -> int:
    f.seek(body)
    return int.from_bytes(f.read(end - body), "big")


def _probe_webm(f: BinaryIO) -> VideoInfo:
    f.seek(0, 2)
    file_end = f.tell()
    doctype = None
    for eid, body, end, unknown in _elements(f, 0, file_end):
        if eid == _EBML:
            for sid, sbody, send, _ in _elements(f, body, end):
                if sid == _DOCTYPE:
                    f.seek(sbody)
                    doctype = f.read(send - sbody).rstrip(b"\0")
        elif eid == _SEGMENT:
            if doctype != b"webm":
                raise ProbeError("Format non reconnu (MP4, MOV ou WebM attendu)")
            for sid, sbody, send, sunknown in _elements(f, body, end):
                if sid == _CLUSTER:
                    break
                if sid != _INFO:
                    continue
                scale, duration = 1_000_000, None
                for iid, ibody, iend, _ in _elements(f, sbody, send):
                    if iid == _TIMECODE_SCALE:
                        scale = _read_uint(f, ibody, iend)
                    elif iid == _DURATION:
                        f.seek(ibody)
                        raw = f.read(iend - ibody)
                        if len(raw) == 4:
                            duration = struct.unpack(">f", raw)[0]
                        elif len(raw) == 8:
                            duration = struct.unpack(">d", raw)[0]
                if duration is None:
                    break
                return VideoInfo("video/webm", duration * scale / 1e9)
            raise ProbeError("Durée de la vidéo illisible (WebM sans durée)")
    raise ProbeError("Format non reconnu (MP4, MOV ou WebM attendu)")
