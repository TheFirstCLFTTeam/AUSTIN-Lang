import { useEffect, useRef } from "react";

export default function AudioPlayer({
  fileUrl,
<<<<<<< HEAD
  audioRef,
  onTimeUpdate = () => {},
  onReady = () => {}
}) {
  const localRef = useRef(null);
  const actualRef = audioRef || localRef;
=======
  onTimeUpdate = () => {},
  onReady = () => {}
}) {
  const audioRef = useRef(null);
>>>>>>> origin/main

  useEffect(() => {
    const node = actualRef.current;
    if (!node) return;

    const handleTimeUpdate = () => {
      onTimeUpdate(node.currentTime);
    };

    node.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      node.removeEventListener("timeupdate", handleTimeUpdate);
    };
<<<<<<< HEAD
  }, [onTimeUpdate, actualRef]);
=======
  }, [onTimeUpdate]);
>>>>>>> origin/main

  return (
    <audio
      ref={actualRef}
      controls
      preload="metadata"
      src={fileUrl}
      onCanPlay={onReady}
      className="w-full mt-4"
    />
  );
}
