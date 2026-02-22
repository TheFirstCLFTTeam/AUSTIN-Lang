import { useEffect, useRef } from "react";

export default function AudioPlayer({
  fileUrl,
  onTimeUpdate = () => {},
  onReady = () => {}
}) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioRef.current) return;

    const handleTimeUpdate = () => {
      onTimeUpdate(audioRef.current.currentTime);
    };

    audioRef.current.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      audioRef.current?.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [onTimeUpdate]);

  return (
    <audio
      ref={audioRef}
      controls
      preload="metadata"
      src={fileUrl}
      onCanPlay={onReady}
      className="w-full mt-4"
    />
  );
}
