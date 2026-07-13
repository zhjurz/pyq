export interface MotionPhotoParts {
  image: Blob;
  video: Blob;
}

function indexOfSequence(bytes: Uint8Array, sequence: number[], start = 0): number {
  for (let i = start; i <= bytes.length - sequence.length; i++) {
    let matched = true;
    for (let j = 0; j < sequence.length; j++) {
      if (bytes[i + j] !== sequence[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

/** Splits a JPEG Motion Photo that appends an MP4 ftyp box after JPEG EOI. */
export async function splitMotionPhoto(file: File): Promise<MotionPhotoParts | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const eoi = indexOfSequence(bytes, [0xff, 0xd9], 2);
  if (eoi < 0) return null;
  const afterEoi = eoi + 2;
  const ftyp = indexOfSequence(bytes, [0x66, 0x74, 0x79, 0x70], afterEoi);
  const videoStart = ftyp - 4;
  if (ftyp < 0 || videoStart < afterEoi || bytes.length - videoStart < 16) return null;

  return {
    image: new Blob([bytes.slice(0, afterEoi)], { type: "image/jpeg" }),
    video: new Blob([bytes.slice(videoStart)], { type: "video/mp4" }),
  };
}
