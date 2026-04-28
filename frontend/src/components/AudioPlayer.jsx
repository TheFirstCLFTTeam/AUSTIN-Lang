import { useEffect, useRef } from "react";

export default function AudioPlayer({
  fileUrl,
  audioRef,
  onTimeUpdate = () => {},
  onReady = () => {}
}) {
  const localRef = useRef(null);
  const actualRef = audioRef || localRef;

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
  }, [onTimeUpdate, actualRef]);

  return (
    <audio
      ref={actualRef}
      preload="metadata"
      src={fileUrl}
      onCanPlay={onReady}
      style={{ display: "none" }}
    />
  );
}
