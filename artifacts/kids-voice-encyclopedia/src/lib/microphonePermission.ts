/** Ask the browser to suppress the guide voice acoustically and keep the
 * child's voice clear. These are ideal constraints so unsupported options
 * never prevent recording. */
export const CHILD_VOICE_MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
  },
};

/** Request microphone permission during an explicit user action, then release
 * the temporary stream. The actual recording obtains its own matching stream. */
export async function primeMicrophonePermission(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>,
): Promise<void> {
  const stream = await mediaDevices.getUserMedia(CHILD_VOICE_MIC_CONSTRAINTS);
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* a temporary track is already stopped */ }
  }
}
