import { useEffect, useRef, useState } from 'react'
import stripOne from '../assets/strip-1.png'
import stripTwo from '../assets/strip-2.png'
import stripThree from '../assets/strip-3.png'
import stripFour from '../assets/strip-4.png'

const filters = [
  { name: 'Original', value: 'none', icon: '☁' },
  { name: 'Dreamy', value: 'brightness(1.08) saturate(.8) sepia(.14)', icon: '✦' },
  { name: 'Mono', value: 'grayscale(1) contrast(1.15)', icon: '◐' },
  { name: 'Honey', value: 'brightness(1.08) saturate(1.25) sepia(.28) contrast(1.04)', icon: '☀' },
  { name: 'Cool', value: 'brightness(1.03) contrast(1.12) saturate(1.1) hue-rotate(18deg)', icon: '☾' },
  { name: 'Vintage', value: 'sepia(.45) contrast(1.06) brightness(.97) saturate(.85)', icon: '✿' },
]

const doodles = ['✦', '♥', '☺', '✿', '☁', '★']
const MAX_REC_SECONDS = 15
const strips = [
  { name: 'Strip 1', src: stripOne, blackWindows: true, slots: [{ x: 39, y: 145, width: 629, height: 459 }, { x: 39, y: 647, width: 629, height: 459 }, { x: 39, y: 1169, width: 629, height: 459 }] },
  { name: 'Strip 2', src: stripTwo, blackWindows: true, slots: [{ x: 39, y: 112, width: 629, height: 459 }, { x: 39, y: 624, width: 629, height: 459 }, { x: 39, y: 1136, width: 629, height: 459 }] },
  { name: 'Strip 3', src: stripThree, blackWindows: true, slots: [{ x: 55, y: 219, width: 597, height: 406 }, { x: 63, y: 685, width: 597, height: 406 }, { x: 63, y: 1151, width: 597, height: 406 }] },
  { name: 'Strip 4', src: stripFour, blackWindows: true, slots: [{ x: 77, y: 163, width: 543, height: 466 }, { x: 82, y: 764, width: 543, height: 466 }, { x: 77, y: 1331, width: 543, height: 466 }] },
]

export default function App() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const cameraRequestRef = useRef(0)
  const fileRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const autoClipRef = useRef(false)
  const mirrorRafRef = useRef(null)
  const mirrorStreamRef = useRef(null)
  const mirrorCanvasRef = useRef(null)
  const recordingRef = useRef(false)
  const countdownActiveRef = useRef(false)
  const autoRestartRef = useRef(false)
  const discardClipRef = useRef(false)
  const [filter, setFilter] = useState(filters[0])
  // Each shot pairs a photo with the video ending at its capture moment,
  // so a photo can always find its corresponding video by id.
  const [moments, setMoments] = useState([])
  const [count, setCount] = useState(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [error, setError] = useState('')
  const [selectedStrip, setSelectedStrip] = useState(strips[0])
  const [overlaySrc, setOverlaySrc] = useState('')
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [activeMomentId, setActiveMomentId] = useState(null)
  const momentIdRef = useRef(0)
  const pendingMomentRef = useRef(null)
  const recordSessionRef = useRef(0)

  const photos = moments.map(moment => moment.photo).filter(Boolean)
  const activeMoment = moments.find(moment => moment.id === activeMomentId) || null
  const [savedStrip, setSavedStrip] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [videoStrip, setVideoStrip] = useState(null)
  const [isSavingVideo, setIsSavingVideo] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [recordedVideo, setRecordedVideo] = useState(null)

  useEffect(() => () => {
    cameraRequestRef.current += 1
    autoRestartRef.current = false
    countdownActiveRef.current = false
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      discardClipRef.current = true
    }
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop() } catch {}
    clearInterval(timerRef.current)
    stopMirrorPipeline()
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (recordedVideo?.blob) URL.revokeObjectURL(recordedVideo.url)
    setMoments(current => {
      current.forEach(moment => { try { moment.clip && URL.revokeObjectURL(moment.clip.url) } catch {} })
      return current
    })
  }, [])

  useEffect(() => {
    let isCurrent = true
    createStripOverlay(selectedStrip.src, selectedStrip.slots, selectedStrip.blackWindows).then(src => {
      if (isCurrent) setOverlaySrc(src)
    })
    return () => { isCurrent = false }
  }, [selectedStrip])

  useEffect(() => {
    if (!previewExpanded && !savedStrip && !recordedVideo && !videoStrip && !activeMoment) return
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setPreviewExpanded(false)
        if (event.key === 'Escape' && savedStrip) closeSavedStrip()
        if (event.key === 'Escape' && recordedVideo) closeRecordedVideo()
        if (event.key === 'Escape' && videoStrip) closeVideoStrip()
        if (event.key === 'Escape' && activeMoment) closeActiveMoment()
      }
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [previewExpanded, savedStrip, recordedVideo, videoStrip, activeMoment])

  async function startCamera() {
    const requestId = ++cameraRequestRef.current
    recordSessionRef.current += 1
    const isRestarting = cameraOn
    try {
      setError('')
      autoRestartRef.current = false
      countdownActiveRef.current = false
      pendingMomentRef.current = null
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        discardClipRef.current = true
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop() } catch {}
      }
      clearInterval(timerRef.current)
      stopMirrorPipeline()
      recordingRef.current = false
      setIsRecording(false)
      setRecSeconds(0)
      if (isRestarting) {
        setMoments(current => {
          current.forEach(moment => { try { moment.clip && URL.revokeObjectURL(moment.clip.url) } catch {} })
          return []
        })
        setActiveMomentId(null)
        if (videoStrip?.blob) { try { URL.revokeObjectURL(videoStrip.url) } catch {} }
        setVideoStrip(null)
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
      // Stall behavior: rolling 15s auto-record starts the moment the
      // camera is live, so the moments before every capture are covered.
      setTimeout(() => { try { startRecording(true) } catch {} }, 400)
    } catch {
      if (requestId === cameraRequestRef.current) {
        setCameraOn(false)
        setError('Camera access was not available. You can still enjoy the booth view!')
      }
    }
  }

  function addPhotoMoment(src) {
    const id = ++momentIdRef.current
    // A rolling recording is active: its endpoint will be this shutter, so
    // the finished clip belongs to this moment. Uploads while recording
    // steal nothing — the capture below re-points the pending marker.
    const expectsClip = recordingRef.current
    if (expectsClip) pendingMomentRef.current = id
    setMoments(current => {
      if (current.length >= 3) {
        const evicted = current[0]
        try { evicted.clip && URL.revokeObjectURL(evicted.clip.url) } catch {}
      }
      const settled = current.map(moment => moment.clipPending ? { ...moment, clipPending: false } : moment)
      return [...settled, { id, photo: { src, filter: filter.name }, clip: null, clipPending: expectsClip }].slice(-3)
    })
    return id
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
          addPhotoMoment(canvas.toDataURL('image/jpeg', 0.92))
        } catch {
          addPhotoMoment(reader.result)
        }
      }
      img.onerror = () => addPhotoMoment(reader.result)
      img.src = reader.result
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function pickVideoMime() {
    const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
    return candidates.find(type => { try { return MediaRecorder.isTypeSupported(type) } catch { return false } }) || ''
  }

  function formatRecTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(1, '0')}:${String(seconds).padStart(2, '0')}`
  }

  function stopMirrorPipeline() {
    if (mirrorRafRef.current) cancelAnimationFrame(mirrorRafRef.current)
    mirrorRafRef.current = null
    mirrorCanvasRef.current = null
    mirrorStreamRef.current?.getTracks().forEach(track => { try { track.stop() } catch {} })
    mirrorStreamRef.current = null
  }

  // Freeze the mirrored feed on its current frame so the recorder's tail
  // holds the capture pose instead of the relaxed moment right after it.
  function freezeMirrorFrame() {
    if (mirrorRafRef.current) cancelAnimationFrame(mirrorRafRef.current)
    mirrorRafRef.current = null
  }

  function startRecording(auto = false) {
    if (recordingRef.current || !streamRef.current) return false
    if (typeof MediaRecorder === 'undefined') {
      if (!auto) setError('Video recording is not supported on this browser, but photos still work!')
      return false
    }
    const session = recordSessionRef.current
    try {
      if (!auto) setError('')
      chunksRef.current = []
      autoClipRef.current = auto
      discardClipRef.current = false
      // Mirror the live feed into a canvas (like the photo shutter does),
      // so the recorded file matches the mirrored preview — not the raw sensor.
      const liveVideo = videoRef.current
      const trackSettings = streamRef.current.getVideoTracks?.()[0]?.getSettings?.() || {}
      const mirrorWidth = liveVideo?.videoWidth || trackSettings.width || 1280
      const mirrorHeight = liveVideo?.videoHeight || trackSettings.height || 720
      const mood = filter.value
      let recordStream = streamRef.current
      if (liveVideo && mirrorWidth && mirrorHeight) {
        try {
          const mirrorCanvas = document.createElement('canvas')
          mirrorCanvas.width = mirrorWidth
          mirrorCanvas.height = mirrorHeight
          mirrorCanvasRef.current = mirrorCanvas
          const mirrorCtx = mirrorCanvas.getContext('2d')
          const drawMirrored = () => {
            try {
              mirrorCtx.filter = mood
              mirrorCtx.save()
              mirrorCtx.translate(mirrorWidth, 0)
              mirrorCtx.scale(-1, 1)
              mirrorCtx.drawImage(liveVideo, 0, 0, mirrorWidth, mirrorHeight)
              mirrorCtx.restore()
            } catch {}
            mirrorRafRef.current = requestAnimationFrame(drawMirrored)
          }
          drawMirrored()
          if (mirrorCanvas.captureStream) {
            recordStream = mirrorCanvas.captureStream(30)
            mirrorStreamRef.current = recordStream
          } else {
            stopMirrorPipeline()
          }
        } catch {
          stopMirrorPipeline()
        }
      }
      const mimeType = pickVideoMime()
      const recorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        clearInterval(timerRef.current)
        stopMirrorPipeline()
        recordingRef.current = false
        setIsRecording(false)
        const wasAuto = autoClipRef.current
        autoClipRef.current = false
        // Rolling windows with no capture are temporary — only the clip
        // ending at the shutter gets saved to the frames.
        const discard = discardClipRef.current
        discardClipRef.current = false
        const shouldRestart = autoRestartRef.current
        autoRestartRef.current = false
        const staleSession = session !== recordSessionRef.current
        const type = recorder.mimeType || mimeType || 'video/mp4'
        const blob = new Blob(chunksRef.current, { type })
        if (!blob.size) {
          if (!wasAuto) setError('Recording was too short. Please try again.')
        } else if (!wasAuto) {
          const extension = type.includes('mp4') ? 'mp4' : 'webm'
          const url = URL.createObjectURL(blob)
          if (recordedVideo?.blob) URL.revokeObjectURL(recordedVideo.url)
          setRecordedVideo({ url, blob, extension, mime: type })
        } else if (!staleSession && !discard) {
          const id = pendingMomentRef.current
          pendingMomentRef.current = null
          if (id != null) {
            const extension = type.includes('mp4') ? 'mp4' : 'webm'
            const url = URL.createObjectURL(blob)
            setMoments(current => current.map(moment => moment.id === id ? { ...moment, clip: { url, blob, extension, mime: type }, clipPending: false } : moment))
          }
        } else {
          // Discarded window, stale session, or orphaned clip: never saved.
          // Just clear any pending marker so no tile waits forever.
          const id = pendingMomentRef.current
          pendingMomentRef.current = null
          if (id != null) {
            setMoments(current => current.map(moment => moment.id === id ? { ...moment, clipPending: false } : moment))
          }
        }
        // Rolling window: keep a fresh 15s recording going so the next
        // capture also has the moments before it.
        if (wasAuto && shouldRestart && !staleSession && streamRef.current) {
          setTimeout(() => { try { startRecording(true) } catch {} }, 300)
        }
        setRecSeconds(0)
      }
      recorder.start(250)
      recordingRef.current = true
      setIsRecording(true)
      setRecSeconds(0)
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setRecSeconds((seconds) => {
          if (seconds + 1 >= MAX_REC_SECONDS) {
            // Don't cut the clip mid-pose: if the 3s photo countdown is
            // running, let the shutter stop the recording at capture instead.
            if (countdownActiveRef.current) return seconds + 1
            // No capture happened in this window — discard it and roll on.
            discardClipRef.current = true
            autoRestartRef.current = true
            stopRecording()
          }
          return seconds + 1
        })
      }, 1000)
      return true
    } catch {
      stopMirrorPipeline()
      if (!auto) setError('Could not start recording. Please try again.')
      autoClipRef.current = false
      return false
    }
  }

  function stopRecording() {
    clearInterval(timerRef.current)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop() } catch {}
    } else {
      stopMirrorPipeline()
      recordingRef.current = false
      setIsRecording(false)
    }
  }

  function closeRecordedVideo() {
    if (recordedVideo?.blob) URL.revokeObjectURL(recordedVideo.url)
    setRecordedVideo(null)
  }

  async function shareVideo() {
    if (!recordedVideo) return
    try {
      const file = new File([recordedVideo.blob], `photobooth-clip.${recordedVideo.extension}`, { type: recordedVideo.mime })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "babi's photobooth clip" })
        return
      }
      if (navigator.share) {
        await navigator.share({ title: "babi's photobooth clip", url: recordedVideo.url })
        return
      }
      window.open(recordedVideo.url, '_blank', 'noopener')
    } catch {
      // User dismissed the share sheet — not an error.
    }
  }

  async function shareClip(clip) {
    if (!clip) return
    try {
      const file = new File([clip.blob], `photobooth-prep.${clip.extension}`, { type: clip.mime })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "babi's photobooth prep clip" })
        return
      }
      if (navigator.share) {
        await navigator.share({ title: "babi's photobooth prep clip", url: clip.url })
        return
      }
      window.open(clip.url, '_blank', 'noopener')
    } catch {
      // User dismissed the share sheet — not an error.
    }
  }

  function snap() {
    if (!cameraOn || count !== null) return
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setError('Your camera is still warming up. Please try again in a moment.')
      return
    }

    setError('')
    // Stall behavior: a rolling 15s recording already covers the prep.
    // The 3s countdown runs, and the shutter stops the video at the exact
    // capture moment — so the photo matches the last video pose.
    countdownActiveRef.current = true
    if (!recordingRef.current) {
      startRecording(true)
    }
    setCount(3)
    const countdown = (number) => {
      if (number > 0) {
        setTimeout(() => {
          // If the camera died mid-countdown, bail out cleanly.
          if (!streamRef.current) {
            countdownActiveRef.current = false
            setCount(null)
            return
          }
          setCount(number - 1 || null)
          if (number === 1) {
            // Freeze first: the recorder holds this exact pose as its tail,
            // and the photo below is lifted from the same frozen frame.
            freezeMirrorFrame()
            captureFrame(video)
            countdownActiveRef.current = false
            if (recordingRef.current) {
              // Fresh rolling window for the next capture.
              autoRestartRef.current = true
              stopRecording()
            }
          } else {
            countdown(number - 1)
          }
        }, 800)
      }
    }
    countdown(3)
  }

  function captureFrame(video) {
    const canvas = document.createElement('canvas')
    // Prefer the exact mirrored frame being recorded: the photo then IS a
    // video frame, so still and clip can never disagree on the pose.
    const mirror = recordingRef.current ? mirrorCanvasRef.current : null
    if (mirror && mirror.width && mirror.height) {
      canvas.width = mirror.width
      canvas.height = mirror.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(mirror, 0, 0)
    } else {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.filter = filter.value
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    }
    addPhotoMoment(canvas.toDataURL('image/jpeg', 0.9))
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

  function closeActiveMoment() {
    setActiveMomentId(null)
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

  function closeVideoStrip() {
    if (videoStrip?.blob) URL.revokeObjectURL(videoStrip.url)
    setVideoStrip(null)
  }

  async function shareVideoStrip() {
    if (!videoStrip) return
    try {
      const file = new File([videoStrip.blob], `sweet-memories.${videoStrip.extension}`, { type: videoStrip.mime })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "babi's photobooth video strip" })
        return
      }
      if (navigator.share) {
        await navigator.share({ title: "babi's photobooth video strip", url: videoStrip.url })
        return
      }
      window.open(videoStrip.url, '_blank', 'noopener')
    } catch {
      // User dismissed the share sheet — not an error.
    }
  }

  async function downloadVideoStrip() {
    if (!photos.length || isSavingVideo || isSaving) return
    const canvas = document.createElement('canvas')
    canvas.width = 707; canvas.height = 2000
    if (!canvas.captureStream) {
      setError('Video strips need a newer browser. Download the photo strip instead — it always works!')
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('Video recording is not supported here. Download the photo strip instead!')
      return
    }
    setIsSavingVideo(true)
    setError('')
    const clipVideos = []
    try {
      const ctx = canvas.getContext('2d')
      const loadImage = (src) => new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src
      })
      const loadClipVideo = (clip) => new Promise((resolve) => {
        try {
          const video = document.createElement('video')
          video.muted = true
          video.loop = false
          video.playsInline = true
          video.preload = 'auto'
          video.src = clip.url
          const done = () => resolve(video)
          video.onloadeddata = done
          video.onerror = () => resolve(null)
          // Resolve anyway after 4s so one slow clip can't block the strip.
          setTimeout(() => resolve(video.readyState >= 2 ? video : null), 4000)
        } catch {
          resolve(null)
        }
      })
      const [frame, ...rest] = await Promise.all([loadImage(selectedStrip.src), ...photos.map(photo => loadImage(photo.src)), overlaySrc ? loadImage(overlaySrc) : Promise.resolve(null)])
      const overlay = rest.pop()
      const slotPhotos = rest
      const slotClips = await Promise.all(moments.map(moment => moment.clip ? loadClipVideo(moment.clip) : Promise.resolve(null)))
      slotClips.forEach(video => { if (video) clipVideos.push(video) })
      // End every slot on its capture pose: start long clips partway in so
      // they finish exactly at export end; short clips play out and hold
      // their last frame (the photo pose) until the end.
      const EXPORT_SECONDS = 6
      await Promise.all(clipVideos.map(video => new Promise((resolve) => {
        const doPlay = () => { video.play().catch(() => {}); resolve() }
        try {
          const duration = video.duration
          if (isFinite(duration) && duration > EXPORT_SECONDS + 0.2) {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked)
              doPlay()
            }
            video.addEventListener('seeked', onSeeked)
            video.currentTime = Math.max(0, duration - EXPORT_SECONDS)
            setTimeout(() => {
              video.removeEventListener('seeked', onSeeked)
              if (video.paused && video.readyState >= 2) video.play().catch(() => {})
              resolve()
            }, 1500)
          } else {
            doPlay()
          }
        } catch {
          doPlay()
        }
      })))

      const stream = canvas.captureStream(30)
      const mimeType = pickVideoMime()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 })
        : new MediaRecorder(stream)
      const chunks = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise((resolve) => { recorder.onstop = resolve })
      const DURATION = EXPORT_SECONDS * 1000
      const HOLD_MS = 600
      const startedAt = performance.now()

      drawVideoStripFrame(ctx, { frame, slotPhotos, slotClips, overlay, progress: 0 })
      recorder.start(250)
      await new Promise((resolve) => {
        const tick = () => {
          const elapsed = performance.now() - startedAt
          // Ken Burns completes at 6s; the extra hold keeps drawing the
          // final pose frames so the file truly ends on the photo.
          const progress = Math.min(1, elapsed / DURATION)
          drawVideoStripFrame(ctx, { frame, slotPhotos, slotClips, overlay, progress })
          if (elapsed < DURATION + HOLD_MS) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })
      recorder.stop()
      await stopped
      const type = recorder.mimeType || mimeType || 'video/mp4'
      const blob = new Blob(chunks, { type })
      if (!blob.size) throw new Error('empty')
      const extension = type.includes('mp4') ? 'mp4' : 'webm'
      if (videoStrip?.blob) URL.revokeObjectURL(videoStrip.url)
      setVideoStrip({ url: URL.createObjectURL(blob), blob, extension, mime: type })
    } catch {
      setError('Could not build your video strip. Download the photo strip instead!')
    } finally {
      clipVideos.forEach(video => { try { video.pause() } catch {} })
      setIsSavingVideo(false)
    }
  }

  function drawVideoStripFrame(ctx, { frame, slotPhotos, slotClips, overlay, progress }) {
    const slots = selectedStrip.slots
    ctx.clearRect(0, 0, 707, 2000)
    ctx.drawImage(frame, 0, 0, 707, 2000)
    slots.forEach((slot, i) => {
      const clip = slotClips[i]
      if (clip && clip.readyState >= 2 && clip.videoWidth) {
        drawCover(ctx, clip, slot)
      } else if (slotPhotos[i]) {
        // Gentle Ken Burns zoom so stills feel alive next to the clips.
        const zoom = 1 + progress * 0.08
        ctx.save()
        ctx.beginPath()
        ctx.rect(slot.x, slot.y, slot.width, slot.height)
        ctx.clip()
        ctx.translate(slot.x + slot.width / 2, slot.y + slot.height / 2)
        ctx.scale(zoom, zoom)
        ctx.translate(-(slot.x + slot.width / 2), -(slot.y + slot.height / 2))
        drawCover(ctx, slotPhotos[i], slot)
        ctx.restore()
      }
    })
    if (overlay) ctx.drawImage(overlay, 0, 0, 707, 2000)
  }

  function drawCover(ctx, image, slot) {
    const naturalWidth = image.videoWidth || image.naturalWidth || image.width
    const naturalHeight = image.videoHeight || image.naturalHeight || image.height
    const imageRatio = naturalWidth / naturalHeight
    const slotRatio = slot.width / slot.height
    let sourceWidth = naturalWidth, sourceHeight = naturalHeight, sourceX = 0, sourceY = 0
    if (imageRatio > slotRatio) {
      sourceWidth = naturalHeight * slotRatio
      sourceX = (naturalWidth - sourceWidth) / 2
    } else {
      sourceHeight = naturalWidth / slotRatio
      sourceY = (naturalHeight - sourceHeight) / 2
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
          <button className="power" onClick={startCamera} type="button">{cameraOn ? '↻' : 'ON'}</button>
        </div>
      </div>
      <aside className="panel">
        <div className="panel-head"><span>01</span><h2>pick a mood</h2></div>
        <div className="filters">{filters.map(f => <button className={filter.name === f.name ? 'active' : ''} key={f.name} onClick={() => setFilter(f)} aria-pressed={filter.name === f.name} type="button"><em style={{filter: f.value}}>{f.icon}</em>{f.name}</button>)}</div>
        <div className="panel-head photos-head"><span>02</span><h2>your snapshots</h2><b>{photos.length}/3</b></div>
        <div className="shots">{[0,1,2].map(i => moments[i]?.photo ? <button key={moments[i].id} className="shot-tile" onClick={() => setActiveMomentId(moments[i].id)} aria-label={`Open photo ${i+1} with its video`} aria-haspopup="dialog" type="button"><img src={moments[i].photo.src} alt={`Snapshot ${i+1}`} />{moments[i].clip && <span className="shot-badge" aria-hidden="true">▶</span>}</button> : <div key={i} className="empty">{doodles[i]}</div>)}</div>
        <div className="panel-head strip-head"><span>03</span><h2>pick a strip</h2></div>
        <div className="strip-options">{strips.map(strip => <button key={strip.name} className={selectedStrip.name === strip.name ? 'selected' : ''} onClick={() => setSelectedStrip(strip)} aria-pressed={selectedStrip.name === strip.name} type="button"><img src={strip.src} alt=""/><span>{strip.name}</span></button>)}</div>
        <div className="strip-preview-wrap">
          <p>live strip preview</p>
          <button className="strip-preview" onClick={() => setPreviewExpanded(true)} aria-label="Open larger strip preview" aria-haspopup="dialog" type="button" style={{ backgroundImage: `url(${selectedStrip.src})` }}>
            {selectedStrip.slots.map((slot, index) => photos[index] && <img key={index} src={photos[index].src} alt={`Preview snapshot ${index + 1}`} style={{ left: `${slot.x / 707 * 100}%`, top: `${slot.y / 2000 * 100}%`, width: `${slot.width / 707 * 100}%`, height: `${slot.height / 2000 * 100}%` }} />)}
            {overlaySrc && <img className="frame-overlay" src={overlaySrc} alt="" />}
          </button>
        </div>
        <button className="print" onClick={downloadStrip} disabled={!photos.length || isSaving || isSavingVideo} type="button">{isSaving ? 'making your strip…' : '↓　download photo strip'}</button>
        <button className="print video-strip" onClick={downloadVideoStrip} disabled={!photos.length || isSavingVideo || isSaving} type="button">{isSavingVideo ? 'making your video…' : '▶　download video strip'}</button>
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
        <small className="result-hint">On iPad / iPhone: tap <b>Share</b> → Save to Photos, or touch-hold the image → Save to Photos.</small>
        {moments.some(moment => moment.clip) && <div className="motion-row">
          <p>this strip in motion</p>
          <div className="motion-clips">{moments.map((moment, index) => moment.clip && <div key={moment.id} className="motion-clip"><video src={moment.clip.url} playsInline preload="metadata" muted /><a href={moment.clip.url} download={`sweet-memories-clip-${index + 1}.${moment.clip.extension}`} aria-label={`Download video for photo ${index + 1}`}>↓ clip {index + 1}</a></div>)}</div>
        </div>}
      </div>
    </div>}
    {recordedVideo && <div className="preview-backdrop" onClick={closeRecordedVideo}>
      <div className="preview-dialog result-dialog" role="dialog" aria-modal="true" aria-label="Your recorded video clip" onClick={event => event.stopPropagation()}>
        <button className="close-preview" onClick={closeRecordedVideo} aria-label="Close video result" type="button">&times;</button>
        <p>your clip is ready!</p>
        <video className="result-video" src={recordedVideo.url} controls playsInline preload="metadata" />
        <div className="result-actions">
          <a className="result-download" href={recordedVideo.url} download={`photobooth-clip.${recordedVideo.extension}`}>↓ download clip</a>
          <button className="result-share" onClick={shareVideo} type="button">⤴ share / save video</button>
          <button className="result-open" onClick={() => window.open(recordedVideo.url, '_blank', 'noopener')} type="button">open full video</button>
        </div>
        <small className="result-hint">On iPad / iPhone: tap <b>Share</b> → Save Video to Photos. Clips are silent, up to 15 seconds.</small>
      </div>
    </div>}
    {videoStrip && <div className="preview-backdrop" onClick={closeVideoStrip}>
      <div className="preview-dialog result-dialog" role="dialog" aria-modal="true" aria-label="Your video photo strip" onClick={event => event.stopPropagation()}>
        <button className="close-preview" onClick={closeVideoStrip} aria-label="Close video strip result" type="button">&times;</button>
        <p>your video strip is ready!</p>
        <video className="result-video tall" src={videoStrip.url} controls playsInline preload="metadata" />
        <div className="result-actions">
          <a className="result-download" href={videoStrip.url} download={`sweet-memories.${videoStrip.extension}`}>↓ download video</a>
          <button className="result-share" onClick={shareVideoStrip} type="button">⤴ share / save video</button>
          <button className="result-open" onClick={() => window.open(videoStrip.url, '_blank', 'noopener')} type="button">open full video</button>
        </div>
        <small className="result-hint">Every clip ends on its photo pose. On iPad: <b>Share</b> → Save Video.</small>
      </div>
    </div>}
    {activeMoment?.photo && <div className="preview-backdrop" onClick={closeActiveMoment}>
      <div className="preview-dialog result-dialog moment-dialog" role="dialog" aria-modal="true" aria-label="Photo with its video" onClick={event => event.stopPropagation()}>
        <button className="close-preview" onClick={closeActiveMoment} aria-label="Close photo and video" type="button">&times;</button>
        <p>photo + its video</p>
        <div className="moment-grid">
          <figure>
            <img src={activeMoment.photo.src} alt="Captured photo" />
            <figcaption>photo · {activeMoment.photo.filter}</figcaption>
          </figure>
          {activeMoment.clip ? <figure>
            <video src={activeMoment.clip.url} controls playsInline preload="metadata" />
            <figcaption>video · ends at this pose</figcaption>
          </figure> : <div className="empty moment-empty">{activeMoment.clipPending ? 'developing…' : 'no video for this shot'}</div>}
        </div>
        <div className="result-actions">
          <a className="result-download" href={activeMoment.photo.src} download="photobooth-photo.jpg">↓ download photo</a>
          {activeMoment.clip && <a className="result-download" href={activeMoment.clip.url} download={`photobooth-video.${activeMoment.clip.extension}`}>↓ download video</a>}
          {activeMoment.clip && <button className="result-share" onClick={() => shareClip(activeMoment.clip)} type="button">⤴ share video</button>}
        </div>
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
      const data = pixels.data
      if (detectBlackOnly) {
        // Punch only large dark regions (the photo windows) so small dark
        // decorations stay opaque and sit on top of photos like stickers.
        const W = canvas.width, H = canvas.height
        const inSlot = (x, y) => slots.some(s => x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height)
        const dark = new Uint8Array(W * H)
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (!inSlot(x, y)) continue
            const o = (y * W + x) * 4
            if (data[o] < 70 && data[o + 1] < 70 && data[o + 2] < 70) dark[y * W + x] = 1
          }
        }
        const label = new Int32Array(W * H).fill(-1)
        const sizes = []
        const stack = []
        for (let i = 0; i < W * H; i++) {
          if (!dark[i] || label[i] !== -1) continue
          const id = sizes.length
          let size = 0
          stack.push(i); label[i] = id
          while (stack.length) {
            const cur = stack.pop(); size++
            const cx = cur % W, cy = (cur / W) | 0
            if (cx > 0) { const n = cur - 1; if (dark[n] && label[n] === -1) { label[n] = id; stack.push(n) } }
            if (cx < W - 1) { const n = cur + 1; if (dark[n] && label[n] === -1) { label[n] = id; stack.push(n) } }
            if (cy > 0) { const n = cur - W; if (dark[n] && label[n] === -1) { label[n] = id; stack.push(n) } }
            if (cy < H - 1) { const n = cur + W; if (dark[n] && label[n] === -1) { label[n] = id; stack.push(n) } }
          }
          sizes.push(size)
        }
        for (let i = 0; i < W * H; i++) {
          if (dark[i] && sizes[label[i]] > 20000) data[i * 4 + 3] = 0
        }
      } else {
        for (const slot of slots) {
          for (let y = slot.y; y < slot.y + slot.height; y++) {
            for (let x = slot.x; x < slot.x + slot.width; x++) {
              const index = (y * canvas.width + x) * 4
              const r = pixels.data[index], g = pixels.data[index + 1], b = pixels.data[index + 2]
              const isSky = b > 190 && g > 180 && r > 155
              const isGrass = g > r * 1.18 && g > b * 1.25
              const isCloud = r > 238 && g > 238 && b > 238
              if (isSky || isGrass || isCloud) pixels.data[index + 3] = 0
            }
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
