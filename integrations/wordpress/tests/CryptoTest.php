<?php
/**
 * Frontiere de securite : chiffrement AES-256-GCM des tokens OAuth
 * (Chapote_BO_Crypto). On verifie : aller-retour, AUTHENTICITE (toute alteration du
 * blob = echec, jamais de clair renvoye), forme du blob (IV 12 / tag 16), et
 * ISOLATION par installation (changer le secret d'install casse le dechiffrement).
 */

use PHPUnit\Framework\TestCase;

final class CryptoTest extends TestCase {

    protected function setUp(): void {
        wpt_reset();
        // Secret d'install fixe => derivation de cle deterministe (cf. key()).
        update_option(Chapote_BO_Crypto::KEY_OPTION, base64_encode(str_repeat("\x42", 32)), false);
    }

    public function test_openssl_aes_256_gcm_is_available(): void {
        $this->assertTrue(
            Chapote_BO_Crypto::available(),
            'AES-256-GCM doit etre disponible (openssl requis pour la crypto des tokens).'
        );
    }

    public function test_encrypt_decrypt_round_trip(): void {
        $plain = '{"access_token":"abc.def.ghi","refresh_token":"r-123"}';
        $blob  = Chapote_BO_Crypto::encrypt($plain);

        $this->assertIsString($blob);
        $this->assertNotSame($plain, $blob, 'Le blob ne doit pas contenir le clair tel quel.');
        $this->assertStringNotContainsString('access_token', base64_decode($blob));
        $this->assertSame($plain, Chapote_BO_Crypto::decrypt($blob));
    }

    public function test_round_trip_supports_empty_and_unicode(): void {
        foreach (array('', 'e', " accents: e a u — emoji 🤖 — \x00\x01 binaire") as $plain) {
            $blob = Chapote_BO_Crypto::encrypt($plain);
            $this->assertIsString($blob);
            $this->assertSame($plain, Chapote_BO_Crypto::decrypt($blob));
        }
    }

    public function test_iv_is_random_so_two_ciphertexts_differ(): void {
        $a = Chapote_BO_Crypto::encrypt('meme-clair');
        $b = Chapote_BO_Crypto::encrypt('meme-clair');
        $this->assertNotSame($a, $b, 'IV aleatoire => deux chiffres du meme clair doivent differer.');
        // ...mais les deux se dechiffrent vers le meme clair.
        $this->assertSame('meme-clair', Chapote_BO_Crypto::decrypt($a));
        $this->assertSame('meme-clair', Chapote_BO_Crypto::decrypt($b));
    }

    public function test_blob_layout_is_iv12_tag16_then_ciphertext(): void {
        $plain = 'X'; // 1 octet de clair => 1 octet de ciphertext en GCM (mode flux)
        $raw   = base64_decode(Chapote_BO_Crypto::encrypt($plain), true);
        $this->assertIsString($raw);
        // 12 (IV) + 16 (tag) + strlen(clair) en GCM.
        $this->assertSame(12 + 16 + strlen($plain), strlen($raw));
    }

    /**
     * Coeur de l'authenticite GCM : alterer le ciphertext doit faire ECHOUER le
     * dechiffrement (tag invalide) et NE JAMAIS renvoyer de clair. Un mode sans
     * verification de tag (ex. CBC) renverrait des octets : ce test l'interdit.
     */
    public function test_tampered_ciphertext_byte_fails_authentication(): void {
        $raw = base64_decode(Chapote_BO_Crypto::encrypt('donnee-sensible'), true);
        $raw[28] = $raw[28] === "\x00" ? "\x01" : "\x00"; // 1er octet de ciphertext
        $this->assertFalse(Chapote_BO_Crypto::decrypt(base64_encode($raw)));
    }

    public function test_tampered_tag_fails_authentication(): void {
        $raw = base64_decode(Chapote_BO_Crypto::encrypt('donnee-sensible'), true);
        $raw[12] = $raw[12] === "\x00" ? "\x01" : "\x00"; // 1er octet du tag GCM
        $this->assertFalse(Chapote_BO_Crypto::decrypt(base64_encode($raw)));
    }

    public function test_tampered_iv_fails_authentication(): void {
        $raw = base64_decode(Chapote_BO_Crypto::encrypt('donnee-sensible'), true);
        $raw[0] = $raw[0] === "\x00" ? "\x01" : "\x00"; // 1er octet de l'IV
        $this->assertFalse(Chapote_BO_Crypto::decrypt(base64_encode($raw)));
    }

    public function test_truncated_or_garbage_blob_fails_cleanly(): void {
        $this->assertFalse(Chapote_BO_Crypto::decrypt(''));
        $this->assertFalse(Chapote_BO_Crypto::decrypt('not-base64-!!!'));
        $this->assertFalse(Chapote_BO_Crypto::decrypt(base64_encode('court'))); // < 28 octets
        $this->assertFalse(Chapote_BO_Crypto::decrypt(base64_encode(str_repeat('A', 28)))); // tag/ct bidon
        $this->assertFalse(Chapote_BO_Crypto::decrypt(false));
    }

    /**
     * Isolation par installation : un blob chiffre sous un secret d'install NE
     * DOIT PAS se dechiffrer apres rotation du secret. Demontre que le secret
     * (option non autoloadee) participe reellement a la cle => un simple dump de
     * la table options (sans le secret/wp-config) ne suffit pas.
     */
    public function test_changing_install_secret_breaks_decryption(): void {
        $blob = Chapote_BO_Crypto::encrypt('token-secret');
        $this->assertSame('token-secret', Chapote_BO_Crypto::decrypt($blob));

        // Rotation du secret d'install (autre installation / autre clef derivee).
        update_option(Chapote_BO_Crypto::KEY_OPTION, base64_encode(str_repeat("\x99", 32)), false);
        $this->assertFalse(
            Chapote_BO_Crypto::decrypt($blob),
            'Un secret d install different ne doit pas pouvoir dechiffrer.'
        );
    }
}
