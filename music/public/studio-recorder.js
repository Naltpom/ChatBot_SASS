// AudioWorklet du studio : copie les échantillons du micro vers le fil principal (enregistrement complet pour l'analyse IA).
class StudioRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('studio-recorder', StudioRecorder)
