import { useEffect, useRef, useState } from 'react'
import stripOne from '../assets/strip-1.png'
import stripTwo from '../assets/strip-2.png'

const filters = [
  { name: 'Original', value: 'none', icon: '☁' },
  { name: 'Dreamy', value: 'brightness(1.08) saturate(.8) sepia(.14)', icon: '✦' },
  { name: 'Mono', value: 'grayscale(1) contrast(1.15)', icon: '◐' },
  { name: 'Honey', value: 'brightness(1.08) saturate(1.25) sepia(.28) contrast(1.04)', icon: '☀' },
  { name: 'Cool', value: 'brightness(1.03) contrast(1.12) saturate(1.1) hue-rotate(18deg)', icon: '☾' },
  { name: 'Vintage', value: 'sepia(.45) contrast(1.06) brightness(.97) saturate(.85)', icon: '✿' },
]

const doodles = ['✦', '♥', '☺', '✿', '☁', '★']
const strips = [
  { name: 'Strip 1', src: stripOne, blackWindows: true, slots: [{ x: 39, y: 145, width: 629, height: 459 }, { x: 39, y: 647, width: 629, height: 459 }, { x: 39, y: 1169, width: 629, height: 459 }] },
  { name: 'Strip 2', src: stripTwo, blackWindows: true, slots: [{ x: 39, y: 112, width: 629, height: 459 }, { x: 39, y: 624, width: 629, height: 459 }, { x: 39, y: 1136, width: 629, height: 459 }] },
]

export default function App() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const cameraRequestRef = useRef(0)
  const fileRef = useRef(null)
  const [filter, setFilter] = useState(filters[0])
  const [photos, setPhotos] = useState([])
  const [count, setCount] = useState(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [error, setError] = useState('')
  const [selectedStrip, setSelectedStrip] = useState(strips[0])
  const [overlaySrc, setOverlaySrc] = useState('')
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [savedStrip, setSavedStrip] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => () => {
    cameraRequestRef.current += 1
    streamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  useEffect(() => {
    let isCurrent = true
    createStripOverlay(selectedStrip.src, selectedStrip.slots, selectedStrip.blackWindows).then(src => {
      if (isCurrent) setOverlaySrc(src)
    })
    return () => { isCurrent = false }
  }, [selectedStrip])

  useEffect(() => {
    if (!previewExpanded && !savedStrip) return
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setPreviewExpanded(false)
        if (event.key === 'Escape' && savedStrip) closeSavedStrip()
      }
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [previewExpanded, savedStrip])

  async function startCamera() {
    const requestId = ++cameraRequestRef.current
    const isRestarting = cameraOn
    try {
      setError('')
      if (isRestarting) {
        setPhotos([])
        setCount(null)
        setPreviewExpanded(false)
      }
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.srcObject = null
      }
      setCameraOn(false)
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })

      // Ignore a delayed stream from an earlier restart click.
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraOn(true)
    } catch {
      if (requestId === cameraRequestRef.current) {
        setCameraOn(false)
        setError('Camera access was not available. You can still enjoy the booth view!')
      }
    }
  }

  function addPhoto(src) {
    setPhotos(current => [...current, { src, filter: filter.name }].slice(-3))
  }

  function uploadPhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || img.width
          canvas.height = img.naturalHeight || img.height
          const ctx = canvas.getContext('2d')
          ctx.filter = filter.value
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          addPhoto(canvas.toDataURL('image/jpeg', 0.92))
        } catch {
          addPhoto(reader.result)
        }
      }
      img.onerror = () => addPhoto(reader.result)
      img.src = reader.result
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function snap() {
    if (!cameraOn || count !== null) return
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setError('Your camera is still warming up. Please try again in a moment.')
      return
    }

    setError('')
    setCount(3)
    const countdown = (number) => {
      if (number > 0) {
        setTimeout(() => {
          setCount(number - 1 || null)
          number === 1 ? captureFrame(video) : countdown(number - 1)
        }, 800)
      }
    }
    countdown(3)
  }

  function captureFrame(video) {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.filter = filter.value
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    addPhoto(canvas.toDataURL('image/jpeg', 0.9))
  }

  async function downloadStrip() {
    if (!photos.length || isSaving) return
    setIsSaving(true)
    setError('')
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 707; canvas.height = 2000
      const ctx = canvas.getContext('2d')
      const loadImage = (src) => new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src
      })
      const [frame, ...rest] = await Promise.all([loadImage(selectedStrip.src), ...photos.map(photo => loadImage(photo.src)), overlaySrc ? loadImage(overlaySrc) : Promise.resolve(null)])
      const overlay = rest.pop()
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
      rest.forEach((img, i) => drawCover(ctx, img, selectedStrip.slots[i]))
      if (overlay) ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise((resolve) => {
        if (canvas.toBlob) canvas.toBlob((b) => resolve(b), 'image/png')
        else resolve(null)
      })
      if (savedStrip) URL.revokeObjectURL(savedStrip.url)
      if (blob) {
        const url = URL.createObjectURL(blob)
        setSavedStrip({ url, blob })
      } else {
        // Very old browser fallback: direct data URL.
        setSavedStrip({ url: canvas.toDataURL('image/png'), blob: null })
      }
    } catch {
      setError('Could not build your strip. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  function closeSavedStrip() {
    if (savedStrip?.blob) URL.revokeObjectURL(savedStrip.url)
    setSavedStrip(null)
  }

  async function shareStrip() {
    if (!savedStrip) return
    try {
      if (savedStrip.blob) {
        const file = new File([savedStrip.blob], 'sweet-memories.png', { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "babi's photobooth strip" })
          return
        }
      }
      if (navigator.share) {
        await navigator.share({ title: "babi's photobooth strip", url: savedStrip.url })
        return
      }
      window.open(savedStrip.url, '_blank', 'noopener')
    } catch {
      // User dismissed the share sheet — not an error.
    }
  }

  function drawCover(ctx, image, slot) {
    const imageRatio = image.width / image.height
    const slotRatio = slot.width / slot.height
    let sourceWidth = image.width, sourceHeight = image.height, sourceX = 0, sourceY = 0
    if (imageRatio > slotRatio) {
      sourceWidth = image.height * slotRatio
      sourceX = (image.width - sourceWidth) / 2
    } else {
      sourceHeight = image.width / slotRatio
      sourceY = (image.height - sourceHeight) / 2
    }
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, slot.x, slot.y, slot.width, slot.height)
  }

  return <main>
    <div className="sparkles">✦　•　✿　•　✦　•　♥</div>
    <header><div className="brand"><span className="logo">♡</span><span>babi's<br/><b>photobooth</b></span></div><p></p></header>
    <section className="booth-wrap">
      <div className="booth">
        <div className="top"><span>✿ PHOTOBOOTH ✿</span><div className="lights"><i/><i/><i/></div></div>
        <div className="screen">
          <video ref={videoRef} autoPlay playsInline muted className={cameraOn ? '' : 'is-hidden'} style={{filter: filter.value}} />
          {!cameraOn && <div className="placeholder"><span>☺</span><strong>say cheese!</strong><small>turn on your camera to begin</small></div>}
          {count !== null && <div className="countdown" role="status" aria-live="assertive">{count}</div>}
          <div className="screen-sticker">♥ cute mode ♥</div>
        </div>
        <div className="controls">
          <button className="camera" onClick={snap} aria-label="Take photo" disabled={!cameraOn || count !== null}>◉</button>
          <span>{cameraOn ? (count !== null ? 'say cheese…' : 'tap to capture') : 'turn on the camera or upload a photo'}</span>
          <button className="power" onClick={startCamera}>{cameraOn ? '↻' : 'ON'}</button>
        </div>
      </div>
      <aside className="panel">
        <div className="panel-head"><span>01</span><h2>pick a mood</h2></div>
        <div className="filters">{filters.map(f => <button className={filter.name === f.name ? 'active' : ''} key={f.name} onClick={() => setFilter(f)} aria-pressed={filter.name === f.name} type="button"><em style={{filter: f.value}}>{f.icon}</em>{f.name}</button>)}</div>
        <div className="panel-head photos-head"><span>02</span><h2>your snapshots</h2><b>{photos.length}/3</b></div>
        <div className="shots">{[0,1,2].map(i => photos[i] ? <img key={i} src={photos[i].src} alt={`Snapshot ${i+1}`} /> : <div key={i} className="empty">{doodles[i]}</div>)}</div>
        <div className="panel-head strip-head"><span>03</span><h2>pick a strip</h2></div>
        <div className="strip-options">{strips.map(strip => <button key={strip.name} className={selectedStrip.name === strip.name ? 'selected' : ''} onClick={() => setSelectedStrip(strip)} aria-pressed={selectedStrip.name === strip.name} type="button"><img src={strip.src} alt=""/><span>{strip.name}</span></button>)}</div>
        <div className="strip-preview-wrap">
          <p>live strip preview</p>
          <button className="strip-preview" onClick={() => setPreviewExpanded(true)} aria-label="Open larger strip preview" aria-haspopup="dialog" type="button" style={{ backgroundImage: `url(${selectedStrip.src})` }}>
            {selectedStrip.slots.map((slot, index) => photos[index] && <img key={index} src={photos[index].src} alt={`Preview snapshot ${index + 1}`} style={{ left: `${slot.x / 707 * 100}%`, top: `${slot.y / 2000 * 100}%`, width: `${slot.width / 707 * 100}%`, height: `${slot.height / 2000 * 100}%` }} />)}
            {overlaySrc && <img className="frame-overlay" src={overlaySrc} alt="" />}
          </button>
        </div>
        <button className="print" onClick={downloadStrip} disabled={!photos.length || isSaving} type="button">{isSaving ? 'making your strip…' : '↓　download photo strip'}</button>
        <input ref={fileRef} className="file-input" type="file" accept="image/*" onChange={uploadPhoto} />
        <button className="upload" onClick={() => fileRef.current?.click()} type="button">+ add a photo instead</button>
        {error && <p className="error">{error}</p>}
      </aside>
    </section>
    {previewExpanded && <div className="preview-backdrop" onClick={() => setPreviewExpanded(false)}>
      <div className="preview-dialog" role="dialog" aria-modal="true" aria-label="Live strip preview" onClick={event => event.stopPropagation()}>
        <button className="close-preview" onClick={() => setPreviewExpanded(false)} aria-label="Close preview" type="button">&times;</button>
        <p>your live strip</p>
        <div className="strip-preview expanded" style={{ backgroundImage: `url(${selectedStrip.src})` }}>
          {selectedStrip.slots.map((slot, index) => photos[index] && <img key={index} src={photos[index].src} alt={`Preview snapshot ${index + 1}`} style={{ left: `${slot.x / 707 * 100}%`, top: `${slot.y / 2000 * 100}%`, width: `${slot.width / 707 * 100}%`, height: `${slot.height / 2000 * 100}%` }} />)}
          {overlaySrc && <img className="frame-overlay" src={overlaySrc} alt="" />}
        </div>
      </div>
    </div>}
    {savedStrip && <div className="preview-backdrop" onClick={closeSavedStrip}>
      <div className="preview-dialog result-dialog" role="dialog" aria-modal="true" aria-label="Your finished photo strip" onClick={event => event.stopPropagation()}>
        <button className="close-preview" onClick={closeSavedStrip} aria-label="Close result" type="button">&times;</button>
        <p>your strip is ready!</p>
        <img className="result-image" src={savedStrip.url} alt="Finished photo strip" />
        <div className="result-actions">
          <a className="result-download" href={savedStrip.url} download="sweet-memories.png">↓ download</a>
          <button className="result-share" onClick={shareStrip} type="button">⤴ share / save to photos</button>
          <button className="result-open" onClick={() => window.open(savedStrip.url, '_blank', 'noopener')} type="button">open full image</button>
        </div>
        <small className="result-hint">On iPad / iPhone: tap <b>Share</b> → Save to Photos, or touch-hold the image → Save to Photos. If Safari asks “Do you want to download?”, tap Download, then tap the download icon → Files.</small>
      </div>
    </div>}
    <footer>made for soft smiles & sunny days <span>✦</span></footer>
  </main>
}

function createStripOverlay(src, slots, detectBlackOnly = false) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 707; canvas.height = 2000
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      for (const slot of slots) {
        for (let y = slot.y; y < slot.y + slot.height; y++) {
          for (let x = slot.x; x < slot.x + slot.width; x++) {
            const index = (y * canvas.width + x) * 4
            const r = pixels.data[index], g = pixels.data[index + 1], b = pixels.data[index + 2]
            const isBlackPlaceholder = r < 70 && g < 70 && b < 70
            const isSky = b > 190 && g > 180 && r > 155
            const isGrass = g > r * 1.18 && g > b * 1.25
            const isCloud = r > 238 && g > 238 && b > 238
            const isPlaceholder = detectBlackOnly ? isBlackPlaceholder : isSky || isGrass || isCloud
            if (isPlaceholder) pixels.data[index + 3] = 0
          }
        }
      }
      context.putImageData(pixels, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = reject
    image.src = src
  })
}
