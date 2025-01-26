export function isAudioFile(file) {
  return (
    file.name.toLowerCase().endsWith('.wav') ||
    file.name.toLowerCase().endsWith('.mp3') ||
    file.name.toLowerCase().endsWith('.ogg') ||
    file.name.toLowerCase().endsWith('.flac')
  )
}

export function stripExtension(fileName) {
  return fileName.replace(/\.[^/.]+$/, '')
}

export function getExtension(fileName) {
  return fileName.split('.').pop().toLowerCase()
}
