"use client"; // Add this line at the very top

import React, { useRef, useEffect, useState, useCallback } from 'react';

// Main App component for the Face Tracking and Recording application
const App = () => {
  // Refs for the video and canvas elements
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // Ref to hold recorded chunks, ensuring up-to-date access in callbacks
  const recordedChunksRef = useRef([]);

  // State variables to manage application logic
  const [mediaRecorder, setMediaRecorder] = useState(null); // MediaRecorder instance
  const [recordedChunks, setRecordedChunks] = useState([]); // Array to store video data chunks (for UI display, not directly for Blob creation)
  const [recording, setRecording] = useState(false); // Boolean to indicate if recording is active
  const [videoUrl, setVideoUrl] = useState(''); // URL for the recorded video
  const [modelsLoaded, setModelsLoaded] = useState(false); // Boolean to track if face-api models are loaded
  const [error, setError] = useState(''); // State to store any error messages
  const [isCameraReady, setIsCameraReady] = useState(false); // State to track camera readiness
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('unknown'); // 'unknown', 'prompt', 'granted', 'denied'

  // Function to load face-api.js models
  // Made loadModels a useCallback to stabilize its reference for useEffect dependencies
  const loadModels = useCallback(async () => {
    try {
      const MODEL_URL = '/models';

      if (typeof window.faceapi === 'undefined') {
        console.warn('faceapi is not yet available. Retrying model load...');
        setTimeout(loadModels, 500); // Recursive call to retry
        return;
      }

      await Promise.all([
        window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        window.faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        window.faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        window.faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
      ]);
      setModelsLoaded(true);
      console.log('Face-API models loaded successfully.');
    } catch (err) {
      console.error('Error loading face-api models:', err);
      setError('Failed to load face tracking models. Please ensure the /models directory is accessible and contains all necessary files.');
    }
  }, []); // Empty dependency array as loadModels itself doesn't depend on external state

  // Function to start the webcam stream.
  const startWebcam = useCallback(async () => {
    setError(''); // Clear any previous error messages.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsCameraReady(true);
        setCameraPermissionStatus('granted');
        console.log('Webcam started.');
      }
    } catch (err) {
      console.error('Error accessing webcam:', err);
      setIsCameraReady(false);
      setCameraPermissionStatus('denied');
      if (err.name === 'NotAllowedError') {
        setError('Camera access denied. Please enable camera permissions in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found. Please ensure a camera is connected and working.');
      } else if (err.name === 'NotReadableError') {
        setError('Camera is already in use or not accessible. Please close other applications using the camera.');
      } else {
        setError(`Failed to access webcam: ${err.message}.`);
      }
    }
  }, []); // useCallback ensures this function is stable across renders.

  // Effect hook to handle initial setup: loading models and starting webcam.
  useEffect(() => {
    // Only attempt to load models and start webcam if faceapi is available
    if (typeof window.faceapi !== 'undefined') {
      loadModels();
      startWebcam();
    } else {
      // If faceapi is not yet available, wait a bit and check again
      const timeoutId = setTimeout(() => {
        if (typeof window.faceapi !== 'undefined') {
          loadModels();
          startWebcam();
        }
      }, 500); // Give it a bit more time to load from CDN

      return () => clearTimeout(timeoutId);
    }

    // Cleanup function to stop the video stream and clear intervals on component unmount
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject;
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
      }
      if (videoRef.current && videoRef.current.detectionIntervalId) {
        clearInterval(videoRef.current.detectionIntervalId);
      }
    };
  }, [loadModels, startWebcam]); // Added loadModels and startWebcam to dependencies

  // Function to handle face detection and drawing on the canvas.
  const handleVideoPlay = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !modelsLoaded || typeof window.faceapi === 'undefined') {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('Video dimensions are 0, retrying face detection after a short delay.');
        setTimeout(handleVideoPlay, 200);
        return;
    }

    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    window.faceapi.matchDimensions(canvas, displaySize);

    const detectionInterval = setInterval(async () => {
      if (!video.paused && !video.ended) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.scale(-1, 1);
        context.translate(-canvas.width, 0);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        context.restore();

        const detections = await window.faceapi.detectAllFaces(
          video,
          new window.faceapi.TinyFaceDetectorOptions()
        ).withFaceLandmarks().withFaceExpressions();

        const resizedDetections = window.faceapi.resizeResults(detections, displaySize);

        window.faceapi.draw.drawDetections(canvas, resizedDetections);
        window.faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
        window.faceapi.draw.drawFaceExpressions(canvas, resizedDetections);
      } else {
        clearInterval(detectionInterval);
      }
    }, 100);

    videoRef.current.detectionIntervalId = detectionInterval;
  }, [modelsLoaded]);

  // Effect hook to attach/detach video play event listener
  useEffect(() => {
    const video = videoRef.current;
    if (video && modelsLoaded) {
      video.addEventListener('play', handleVideoPlay);
    }

    return () => {
      if (video) {
        video.removeEventListener('play', handleVideoPlay);
        if (video.detectionIntervalId) {
          clearInterval(video.detectionIntervalId);
        }
      }
    };
  }, [modelsLoaded, handleVideoPlay]);

  // Function to start video recording.
  const startRecording = () => {
    if (!videoRef.current || !canvasRef.current || !isCameraReady) {
      setError('Camera not ready or models not loaded. Please ensure camera access and models are loaded.');
      return;
    }

    // Get the stream ONLY from the canvas, as it now contains both video and markers.
    const canvasStream = canvasRef.current.captureStream();

    let supportedMimeType = '';
    const possibleMimeTypes = [
      'video/webm; codecs=vp9,opus',
      'video/webm; codecs=vp8,opus',
      'video/webm; codecs=vp9',
      'video/webm; codecs=vp8',
      'video/webm',
      'video/mp4; codecs=avc1'
    ];

    for (const type of possibleMimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        supportedMimeType = type;
        console.log(`Using supported MIME type: ${supportedMimeType}`);
        break;
      }
    }

    if (!supportedMimeType) {
      setError('Your browser does not support any common video recording codecs. Try updating your browser or using a different one.');
      console.error('No supported MIME type found for MediaRecorder.');
      return;
    }

    const options = { mimeType: supportedMimeType, timeslice: 2000 };
    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, options);
    } catch (e) {
      console.error('Error creating MediaRecorder:', e);
      setError(`Failed to create video recorder: ${e.message}. Try a different browser or check codec support.`);
      return;
    }

    recordedChunksRef.current = [];
    setRecordedChunks([]);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        console.log('Data available! Chunk size:', event.data.size);
        recordedChunksRef.current.push(event.data);
      } else {
        console.warn('Empty data chunk received from MediaRecorder.');
      }
    };

    recorder.onstart = () => {
      console.log('MediaRecorder started. State:', recorder.state);
      setError('');
    };

    recorder.onstop = () => {
      console.log('MediaRecorder stopped. State:', recorder.state);
      console.log('Recorded chunks length on stop (from ref):', recordedChunksRef.current.length);

      if (recordedChunksRef.current.length > 0) {
        const blob = new Blob(recordedChunksRef.current, { type: supportedMimeType.split(';')[0] });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        console.log('Recording stopped. Video URL:', url);
      } else {
        setError('Recording stopped, but no video data was captured. This might be due to codec issues or camera not providing data.');
        setVideoUrl('');
      }
      recordedChunksRef.current = [];
      setRecordedChunks([]);
    };

    setTimeout(() => {
      if (recorder.state === 'inactive') {
        recorder.start();
        setMediaRecorder(recorder);
        setRecording(true);
        setVideoUrl('');
        console.log('Recording started.');
      }
    }, 200);

  };

  // Function to stop video recording.
  const stopRecording = () => {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
      setRecording(false);
      console.log('Stopping recording...');
    }
  };

  // Function to download the recorded video.
  const downloadVideo = () => {
    if (videoUrl) {
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `face-tracking-video-${Date.now()}.webm`;
      document.body.appendChild(a);
      document.body.removeChild(a);
      URL.revokeObjectURL(videoUrl);
      setVideoUrl('');
      console.log('Video downloaded.');
    }
  };

  return (
    // Main container div with Tailwind CSS classes for styling and responsiveness.
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4 font-inter">
      {/* Application Title */}
      <h1 className="text-4xl font-bold mb-8 text-center text-blue-400">
        Face Tracking & Recording
      </h1>

      {/* Error Message Display */}
      {error && (
        <div className="bg-red-500 text-white p-3 rounded-lg mb-4 shadow-md text-center">
          {error}
        </div>
      )}

      {/* Loading Indicator for Face-API Models */}
      {!modelsLoaded && (
        <div className="text-lg text-gray-400 mb-4">Loading face tracking models...</div>
      )}

      {/* Video and Canvas Container */}
      <div className="relative w-full max-w-2xl bg-gray-800 rounded-xl shadow-2xl overflow-hidden mb-8 aspect-video">
        {/* Video element to display the webcam feed. */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline // Ensures video plays inline on mobile devices.
          className="w-full h-full object-cover rounded-xl"
          style={{ transform: 'scaleX(-1)' }} // Flips video horizontally for a mirror effect.
        ></video>
        {/* Canvas element overlaid on the video for drawing face markers. */}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full rounded-xl"
          style={{ transform: 'scaleX(-1)' }} // Flips canvas horizontally to match the video.
        ></canvas>
        {/* Overlay messages based on camera readiness and permission status. */}
        {!isCameraReady && cameraPermissionStatus === 'unknown' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 text-white text-xl rounded-xl">
                Initializing camera...
            </div>
        )}
        {!isCameraReady && cameraPermissionStatus === 'prompt' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 text-white text-xl rounded-xl">
                Waiting for camera access...
            </div>
        )}
        {!isCameraReady && cameraPermissionStatus === 'denied' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 text-red-400 text-xl rounded-xl">
                Camera access denied. Please allow camera permissions.
            </div>
        )}
      </div>

      {/* Control Buttons Section */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        {/* Request Camera Access Button (shown only if camera is not ready and permission is not granted) */}
        {!isCameraReady && cameraPermissionStatus !== 'granted' && (
            <button
              onClick={startWebcam}
              className="px-8 py-3 rounded-full font-semibold text-lg bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white shadow-lg transform hover:scale-105 active:scale-95 transition-all duration-300 ease-in-out"
            >
              Request Camera Access
            </button>
        )}

        {/* Start Recording Button */}
        <button
          onClick={startRecording}
          // Button is disabled if already recording, models aren't loaded, or camera isn't ready.
          disabled={recording || !modelsLoaded || !isCameraReady}
          className={`px-8 py-3 rounded-full font-semibold text-lg transition-all duration-300 ease-in-out
            ${recording || !modelsLoaded || !isCameraReady
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed' // Disabled state styling.
              : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg transform hover:scale-105 active:scale-95' // Active state styling.
            }`}
        >
          {recording ? 'Recording...' : 'Start Recording'} {/* Dynamic text based on recording state. */}
        </button>

        {/* Stop Recording Button */}
        <button
          onClick={stopRecording}
          disabled={!recording} // Button is disabled if not currently recording.
          className={`px-8 py-3 rounded-full font-semibold text-lg transition-all duration-300 ease-in-out
            ${!recording
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed' // Disabled state styling.
              : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg transform hover:scale-105 active:scale-95' // Active state styling.
            }`}
        >
          Stop Recording
        </button>
      </div>

      {/* Display Recorded Video Section */}
      {videoUrl && ( // Only show this section if a video has been recorded and its URL is available.
        <div className="w-full max-w-2xl bg-gray-800 rounded-xl shadow-2xl p-4">
          <h2 className="text-2xl font-bold mb-4 text-center text-blue-300">Recorded Video</h2>
          <video
            src={videoUrl}
            controls // Show video controls (play, pause, volume, etc.).
            className="w-full h-auto rounded-lg mb-4 shadow-inner"
          ></video>
          {/* Download Button for the recorded video. */}
          <button
            onClick={downloadVideo}
            className="w-full px-6 py-3 rounded-full font-semibold text-lg bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white shadow-lg transform hover:scale-105 active:scale-95 transition-all duration-300 ease-in-out"
          >
            Download Video
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
