import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.8/dist/module.esm.js'
import { isAudioFile, getExtension, stripExtension } from './utils.js'

/** @type {AudioContext}*/
let audioContext

/** @type {CanvasRenderingContext2D | null}*/
let overlayCtx

/** @type {CanvasRenderingContext2D | null}*/
let wavCtx

/** @type {HTMLCanvasElement | null}*/
let overlay

/** @type {HTMLCanvasElement | null}*/
let waveform

/** @type {AudioBufferSourceNode | null} */
let source = null

/** @type {AudioBuffer | null} */
let audioBuffer = null

let startTime = 0

Alpine.data('app', () => ({
  /** @type {FileSystemHandle | null} */
  selectedFile: null,
  selectedFileInfo: {
    channels: 0,
    type: 0,
    duration: 0,
  },
  /** @type {FileSystemHandle[]} */
  fileList: [],
  playing: false,
  loop: false,
  cancel: false,
  currentTime: 0,

  async init() {
    overlay = this.$refs.overlayCanvas
    waveform = this.$refs.wavCanvas
    overlayCtx = overlay.getContext('2d')
    wavCtx = waveform.getContext('2d')

    addEventListener('resize', resizeCanvas)
    resizeCanvas()
    overlayText('Open a directory to start')
  },

  async openDir() {
    try {
      /** @type {FileSystemDirectoryHandle} */
      const pickedDir = await window.showDirectoryPicker()

      this.$refs.loadingDialog.showModal()

      if (source) {
        source.stop()
      }

      this.fileList = []
      this.selectedFile = null
      this.selectedFileInfo = {
        channels: 0,
        sampleRate: 0,
        duration: 0,
      }

      this.playing = false
      this.cancel = false
      source = null
      wavCtx.clearRect(0, 0, waveform.width, waveform.height)
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height)

      await this.readDir(pickedDir, pickedDir)

      // Sort the files by display name
      this.fileList.sort((a, b) => {
        return a.dispName.localeCompare(b.dispName)
      })

      this.$refs.loadingDialog.close()
    } catch (err) {
      console.log('User canceled directory picker')
    }
  },

  /**
   * Read all files in a directory and its subdirectories
   * @param {FileSystemDirectoryHandle} dir
   * @param {FileSystemDirectoryHandle} topDir
   */
  async readDir(dir, topDir) {
    for await (const entry of dir.values()) {
      if (this.cancel) {
        return
      }

      if (entry.kind === 'file' && isAudioFile(entry)) {
        const resolvedNames = await topDir.resolve(entry)

        entry.dispName = resolvedNames.join(' / ')
        entry.dispName = stripExtension(entry.dispName)

        this.fileList.push(entry)
      }

      if (entry.kind === 'directory') {
        await this.readDir(entry, topDir)
      }
    }
  },

  async selectFile(fileEntry) {
    // First interaction with the page that requires an audio context
    if (!audioContext) {
      audioContext = new AudioContext()
    }

    this.selectedFile = fileEntry

    if (source) {
      source.stop()
      source = null
    }

    /** @type {File} */
    const file = await this.selectedFile.getFile()
    const buffer = await file.arrayBuffer()

    if (file.size > 50000000) {
      overlayText('Loading large file, please wait...')
    }

    audioBuffer = await audioContext.decodeAudioData(buffer, null, (err) => {
      console.error('Error decoding audio data', err)
      overlayText('Error decoding audio data')
    })

    this.selectedFileInfo = {
      channels: audioBuffer.numberOfChannels,
      type: getExtension(file.name),
      duration: audioBuffer.duration.toFixed(2),
    }

    drawWaveform()
    this.play(0)
  },

  toggleLoop() {
    if (source) {
      source.loop = !source.loop
      this.loop = !this.loop
    }
  },

  playPause() {
    if (this.playing) {
      this.pause()
    } else {
      this.play(this.currentTime)
    }
  },

  stop() {
    if (source) {
      source.stop()
      this.playing = false
      this.currentTime = 0
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
    }
  },

  pause() {
    if (source) {
      source.stop()
      this.playing = false
    }
  },

  play(offsetTime = 0) {
    if (source) {
      source.stop()
    }

    source = audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.loop = this.loop
    source.connect(audioContext.destination)
    startTime = audioContext.currentTime - offsetTime
    this.currentTime = offsetTime
    this.playing = true

    source.start(0, offsetTime)
    this.drawPlayingLine()
  },

  drawPlayingLine() {
    if (source && this.playing) {
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height)

      const currentTime = audioContext.currentTime - startTime
      const x = (currentTime / source.buffer.duration) * waveform.width
      this.currentTime = currentTime

      if (x > waveform.width) {
        if (source.loop) {
          startTime = audioContext.currentTime
        } else {
          this.playing = false
          this.currentTime = 0
          return
        }
      }

      // Draw the line
      overlayCtx.beginPath()
      overlayCtx.moveTo(x, 0)
      overlayCtx.lineTo(x, overlay.height)
      overlayCtx.strokeStyle = 'rgba(255, 166, 0, 0.8)'
      overlayCtx.lineWidth = 4
      overlayCtx.stroke()

      // Draw the time next to the line
      overlayCtx.font = 'bold 16px Arial'
      overlayCtx.textAlign = 'left'
      overlayCtx.fillStyle = 'rgba(255, 166, 0, 0.8)'
      const textW = overlayCtx.measureText(`${currentTime.toFixed(2)}s`).width
      let offset = 5
      if (x + textW + 5 > overlay.width) {
        offset = -5 - textW
      }
      overlayCtx.fillText(`${currentTime.toFixed(2)}s`, x + offset, 20)

      // Loop the draw function
      requestAnimationFrame(this.drawPlayingLine.bind(this))
    }
  },

  wavClick(event) {
    if (!audioBuffer) {
      return
    }

    const rect = waveform.getBoundingClientRect()
    const x = event.clientX - rect.left
    const percent = x / waveform.width
    const time = audioBuffer.duration * percent

    this.play(time)
  },
}))

Alpine.start()

function resizeCanvas() {
  if (!waveform || !overlay) {
    return
  }
  const rect = document.getElementById('wavContainer').getBoundingClientRect()
  waveform.width = rect.width
  overlay.width = rect.width
  drawWaveform()
}

function drawWaveform() {
  if (!audioBuffer) {
    return
  }

  const width = waveform.width
  const height = waveform.height
  wavCtx.clearRect(0, 0, width, height)

  wavCtx.strokeStyle = 'rgba(30, 211, 30, 0.3)'
  wavCtx.lineWidth = 2.0

  const channelDataL = audioBuffer.getChannelData(0)
  let channelDataR = null
  if (audioBuffer.numberOfChannels === 2) {
    channelDataR = audioBuffer.getChannelData(1)
  }

  // Magic formula to not draw all the samples but also look good
  let scale = Math.floor((channelDataL.length / width) * 0.05)
  if (scale < 1) {
    scale = 1
  }

  for (let i = 0; i < channelDataL.length; i += scale) {
    const x = (i / channelDataL.length) * width

    let sampleVal = 0
    if (audioBuffer.numberOfChannels === 2) {
      // Average the two channels
      sampleVal = (channelDataL[i] + channelDataR[i]) / 2
    } else {
      sampleVal = channelDataL[i]
    }

    const y = ((sampleVal + 1) / 2) * height

    // Draw line from center of canvas up or down based on sample value
    wavCtx.beginPath()
    wavCtx.moveTo(x, height / 2)
    wavCtx.lineTo(x, y)
    wavCtx.stroke()
  }
}

function overlayText(message) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
  wavCtx.clearRect(0, 0, waveform.width, waveform.height)
  overlayCtx.font = '24px Arial'
  overlayCtx.textAlign = 'center'
  overlayCtx.textBaseline = 'middle'
  overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  overlayCtx.fillText(message, overlay.width / 2, overlay.height / 2)
}
