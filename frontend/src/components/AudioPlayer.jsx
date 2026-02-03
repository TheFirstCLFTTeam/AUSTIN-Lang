import { useEffect, useState } from "react";

export default function AudioPlayer({ file, fileUrl }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (file instanceof File) {
      const objectUrl = URL.createObjectURL(file);
      setSrc(objectUrl);

      return () => URL.revokeObjectURL(objectUrl);
    }

    if (typeof fileUrl === "string") {
      setSrc(fileUrl);
    }
  }, [file, fileUrl]);

  if (!src) return null;

  return (
    <audio controls className="w-full mt-4">
      <source src={src} />
    </audio>
  );
}