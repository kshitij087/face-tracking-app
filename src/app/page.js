"use client"; // Marks this component as a Client Component

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
  const [recordedChunks, setRecordedChunks] = useState([]); // Array to store video data chunks (for UI display)
  const [recording, setRecording] = useState(false); // Boolean to indicate if recording is active
  const [videoUrl, setVideoUrl] = useState(''); // URL for the recorded video
  const [modelsLoaded, setModelsLoaded] = useState(false); // Boolean to track if face-api models are loaded
  const [error, setError] = useState(''); // State to store any error messages
  const [isCameraReady, setIsCameraReady] = useState(false); // State to track camera readiness
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('unknown'); // 'unknown', 'prompt', 'granted', 'denied'
  // NEW: State for tracking expression counts
  const [expressionCounts, setExpressionCounts] = useState({
    neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0
  });

  // Function to load face-api.js models
  // Made loadModels a useCallback to stabilize its reference for useEffect dependencies
  const loadModels = useCallback(async () => {
    try {
      const MODEL_URL = '/models'; // Path to the downloaded face-api.js models

      // Ensure window.faceapi is available before attempting to load models.
      if (typeof window.faceapi === 'undefined') {
        console.warn('faceapi is not yet available. Retrying model load...');
        setTimeout(loadModels, 500); // Recursive call to retry after a delay
        return;
      }

      // Load all necessary face-api.js models concurrently
      await Promise.all([
        window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL), // Lightweight face detector
        window.faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL), // Facial landmark detection
        window.faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL), // Face recognition (dependency for some models)
        window.faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL) // Facial expression detection
      ]);
      setModelsLoaded(true); // Update state to indicate models are successfully loaded
      console.log('Face-API models loaded successfully.');
    } catch (err) {
      console.error('Error loading face-api models:', err);
      setError('Failed to load face tracking models. Please ensure the /models directory is accessible and contains all necessary files.');
    }
  }, []); // Empty dependency array as loadModels itself doesn't depend on external state

  // Function to start the webcam stream
  const startWebcam = useCallback(async () => {
    setError(''); // Clear any previous error messages
    try {
      // Request access to the user's video stream
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream; // Set video element's source to the stream
        videoRef.current.play(); // Start playing the video
        setIsCameraReady(true); // Indicate camera is ready
        setCameraPermissionStatus('granted'); // Update permission status
        console.log('Webcam started.');
      }
    } catch (err) {
      console.error('Error accessing webcam:', err);
      setIsCameraReady(false); // Camera is not ready
      setCameraPermissionStatus('denied'); // Update permission status
      // Provide specific error messages based on the type of MediaStreamError
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
  }, []); // useCallback ensures this function is stable across renders

  // Effect hook to handle initial setup: loading models and starting webcam
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

      return () => clearTimeout(timeoutId); // Cleanup timeout
    }

    // Cleanup function to stop the video stream and clear intervals on component unmount
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject;
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop()); // Stop all media tracks
      }
      if (videoRef.current && videoRef.current.detectionIntervalId) {
        clearInterval(videoRef.current.detectionIntervalId); // Clear detection interval
      }
    };
  }, [loadModels, startWebcam]); // Dependencies: loadModels and startWebcam

  // Function to handle face detection and drawing on the canvas
  const handleVideoPlay = useCallback(async () => {
    // Exit if essential elements or models/faceapi are not ready
    if (!videoRef.current || !canvasRef.current || !modelsLoaded || typeof window.faceapi === 'undefined') {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d'); // Get 2D rendering context

    // IMPORTANT: Only proceed if video has valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('Video dimensions are 0, retrying face detection after a short delay.');
        setTimeout(handleVideoPlay, 200); // Retry after a short delay
        return;
    }

    // Set canvas dimensions to match video dimensions for accurate drawing
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    window.faceapi.matchDimensions(canvas, displaySize);

    // Set up an interval to continuously perform face detection and drawing
    const detectionInterval = setInterval(async () => {
      if (!video.paused && !video.ended) {
        // Draw the current video frame onto the canvas FIRST
        context.clearRect(0, 0, canvas.width, canvas.height); // Clear previous frame
        context.save(); // Save the current canvas state
        context.scale(-1, 1); // Flip horizontally for mirror effect
        context.translate(-canvas.width, 0); // Translate back to draw correctly
        context.drawImage(video, 0, 0, canvas.width, canvas.height); // Draw video frame
        context.restore(); // Restore the canvas state

        // Detect all faces with landmarks and expressions
        const detections = await window.faceapi.detectAllFaces(
          video, // Detect on the video element
          new window.faceapi.TinyFaceDetectorOptions()
        ).withFaceLandmarks().withFaceExpressions();

        // Resize detected results to fit the display size of the canvas
        const resizedDetections = window.faceapi.resizeResults(detections, displaySize);

        // Draw the detected face bounding boxes on top of the video frame
        window.faceapi.draw.drawDetections(canvas, resizedDetections);
        // Draw the facial landmark points on top of the video frame
        window.faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
        // Draw face expressions on top of the video frame
        window.faceapi.draw.drawFaceExpressions(canvas, resizedDetections);

        // NEW: Update expression counts
        if (resizedDetections.length > 0) {
          setExpressionCounts(prevCounts => {
            const newCounts = { ...prevCounts };
            resizedDetections.forEach(detection => {
              const expressions = detection.expressions;
              if (expressions) {
                // Find the dominant expression for the current face
                const dominantExpression = Object.keys(expressions).reduce((a, b) => expressions[a] > expressions[b] ? a : b);
                newCounts[dominantExpression]++; // Increment count for dominant expression
              }
            });
            return newCounts;
          });
        }

      } else {
        // If video is paused or ended, stop the detection interval
        clearInterval(detectionInterval);
      }
    }, 100); // Run detection and drawing every 100 milliseconds

    videoRef.current.detectionIntervalId = detectionInterval; // Store interval ID for cleanup
  }, [modelsLoaded]); // Dependency array: modelsLoaded

  // Effect hook to attach/detach the 'play' event listener to the video element
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
  }, [modelsLoaded, handleVideoPlay]); // Dependencies: modelsLoaded and handleVideoPlay

  // Function to start video recording
  const startRecording = () => {
    // Check if camera is ready and models are loaded before starting recording
    if (!videoRef.current || !canvasRef.current || !isCameraReady) {
      setError('Camera not ready or models not loaded. Please ensure camera access and models are loaded.');
      return;
    }

    // Get the stream ONLY from the canvas, as it now contains both video and markers
    const canvasStream = canvasRef.current.captureStream();

    let supportedMimeType = '';
    // Prioritize webm with vp9, then vp8, then generic webm, then mp4 as a last resort
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

    const options = { mimeType: supportedMimeType, timeslice: 2000 }; // Increased timeslice to 2 seconds for more reliable chunks
    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, options);
    } catch (e) {
      console.error('Error creating MediaRecorder:', e);
      setError(`Failed to create video recorder: ${e.message}. Try a different browser or check codec support.`);
      return;
    }

    // Clear previous recorded chunks from the ref before starting new recording
    recordedChunksRef.current = [];
    setRecordedChunks([]); // Also clear the state for UI consistency

    // Event listener for when data (video chunks) becomes available
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        console.log('Data available! Chunk size:', event.data.size);
        recordedChunksRef.current.push(event.data); // Push data to the ref
      } else {
        console.warn('Empty data chunk received from MediaRecorder.');
      }
    };

    // Event listener for when recording starts
    recorder.onstart = () => {
      console.log('MediaRecorder started. State:', recorder.state);
      setError(''); // Clear any previous recording errors
    };

    // Event listener for when recording stops
    recorder.onstop = () => {
      console.log('MediaRecorder stopped. State:', recorder.state);
      console.log('Recorded chunks length on stop (from ref):', recordedChunksRef.current.length);

      // Process recorded chunks from the ref
      if (recordedChunksRef.current.length > 0) {
        const blob = new Blob(recordedChunksRef.current, { type: supportedMimeType.split(';')[0] });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url); // Update state to display video
        console.log('Recording stopped. Video URL:', url);
      } else {
        setError('Recording stopped, but no video data was captured. This might be due to codec issues or camera not providing data.');
        setVideoUrl('');
      }
      recordedChunksRef.current = []; // Clear ref for next recording
      setRecordedChunks([]); // Clear state for UI consistency
    };

    // Add a small delay before starting the recorder to ensure streams are fully active
    setTimeout(() => {
      if (recorder.state === 'inactive') { // Only start if not already started by some other event
        recorder.start(); // Start the recording
        setMediaRecorder(recorder); // Store the recorder instance in state
        setRecording(true); // Update recording status to true
        setVideoUrl(''); // Clear any previous video URL
        console.log('Recording started.');
      }
    }, 200);

  };

  // Function to stop video recording
  const stopRecording = () => {
    if (mediaRecorder && recording) {
      mediaRecorder.stop(); // Stop the MediaRecorder
      setRecording(false); // Update recording status to false
      console.log('Stopping recording...');
    }
  };

  // NEW: Function to reset expression counts
  const resetExpressionCounts = () => {
    setExpressionCounts({
      neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0
    });
  };

  // Function to download the recorded video
  const downloadVideo = () => {
    if (videoUrl) {
      const a = document.createElement('a'); // Create a temporary anchor element
      a.href = videoUrl; // Set the download link to the video URL
      a.download = `face-tracking-video-${Date.now()}.webm`; // Set the default filename for download
      document.body.appendChild(a); // Append the anchor to the body (necessary for some browsers)
      a.click(); // Programmatically click the link to trigger the download
      document.body.removeChild(a); // Remove the temporary anchor element
      URL.revokeObjectURL(videoUrl); // Release the object URL to free up memory
      setVideoUrl(''); // Clear the video URL after download
      console.log('Video downloaded.');
    }
  };

  return (
    // Main container div with Tailwind CSS for aesthetic background, styling, and responsiveness
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-950 to-purple-950 text-white flex flex-col items-center justify-center p-4 font-inter">
      {/* Application Title */}
      <h1 className="text-4xl font-extrabold mb-8 text-center text-blue-300 drop-shadow-lg">
        Face Tracking & Recording
      </h1>

      {/* Error Message Display */}
      {error && (
        <div className="bg-red-600 text-white p-3 rounded-lg mb-4 shadow-md text-center border border-red-400">
          {error}
        </div>
      )}

      {/* Loading Indicator for Face-API Models */}
      {!modelsLoaded && (
        <div className="text-lg text-gray-400 mb-4 animate-pulse">Loading face tracking models...</div>
      )}

      {/* Video and Canvas Container */}
      <div className="relative w-full max-w-2xl bg-gray-800 rounded-xl shadow-2xl overflow-hidden mb-8 aspect-video border-2 border-blue-600">
        {/* Video element to display the webcam feed */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline // Ensures video plays inline on mobile devices
          className="w-full h-full object-cover rounded-xl"
          style={{ transform: 'scaleX(-1)' }} // Flips video horizontally for a mirror effect
        ></video>
        {/* Canvas element overlaid on the video for drawing face markers */}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full rounded-xl"
          style={{ transform: 'scaleX(-1)' }} // Flips canvas horizontally to match the video
        ></canvas>
        {/* Overlay messages based on camera readiness and permission status */}
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
      <div className="flex flex-col sm:flex-row gap-4 mb-8 w-full max-w-2xl justify-center">
        {/* Request Camera Access Button (shown only if camera not ready and permission is not granted) */}
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
          // Button is disabled if already recording, models aren't loaded, or camera isn't ready
          disabled={recording || !modelsLoaded || !isCameraReady}
          className={`px-8 py-3 rounded-full font-semibold text-lg transition-all duration-300 ease-in-out
            ${recording || !modelsLoaded || !isCameraReady
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed' // Disabled state styling
              : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg transform hover:scale-105 active:scale-95' // Active state styling
            }`}
        >
          {recording ? 'Recording...' : 'Start Recording'} {/* Dynamic text based on recording state */}
        </button>

        {/* Stop Recording Button */}
        <button
          onClick={stopRecording}
          disabled={!recording} // Button is disabled if not currently recording
          className={`px-8 py-3 rounded-full font-semibold text-lg transition-all duration-300 ease-in-out
            ${!recording
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed' // Disabled state styling
              : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg transform hover:scale-105 active:scale-95' // Active state styling
            }`}
        >
          Stop Recording
        </button>
      </div>

      {/* NEW: Expression Statistics Output Box */}
      <div className="w-full max-w-2xl bg-gray-800 rounded-xl shadow-2xl p-6 mb-8 border-2 border-purple-600">
        <h2 className="text-2xl font-bold mb-4 text-center text-purple-300">Expression Statistics</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
          {Object.entries(expressionCounts).map(([expression, count]) => (
            <div key={expression} className="bg-gray-700 p-3 rounded-lg text-center shadow-inner">
              <p className="text-sm text-gray-300 capitalize">{expression}</p>
              <p className="text-2xl font-bold text-white">{count}</p>
            </div>
          ))}
        </div>
        <button
          onClick={resetExpressionCounts}
          className="w-full px-6 py-3 rounded-full font-semibold text-lg bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white shadow-lg transform hover:scale-105 active:scale-95 transition-all duration-300 ease-in-out"
        >
          Reset Counts
        </button>
      </div>

      {/* Enhanced Display Recorded Video Section */}
      {videoUrl && (
        <div className="w-full max-w-2xl bg-gray-800 rounded-xl shadow-2xl p-6 border-2 border-green-600">
          <h2 className="text-2xl font-bold mb-4 text-center text-green-300">Recorded Video Preview</h2>
          <video
            src={videoUrl}
            controls // Show video controls (play, pause, volume, etc.)
            className="w-full h-auto rounded-lg mb-4 shadow-inner border border-gray-600"
          ></video>
          {/* Download Button */}
          <button
            onClick={downloadVideo}
            className="w-full px-6 py-3 rounded-full font-semibold text-lg bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white shadow-lg transform hover:scale-105 active:scale-95 transition-all duration-300 ease-in-out"
          >
            Download Video
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
