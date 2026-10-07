/** Request microphone permission during an explicit user action, then release
 * the temporary stream. Recording obtains its own stream only after the guide. */
export async function primeMicrophonePermission(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>,
): Promise<void> {
  const stream = await mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* a temporary track is already stopped */ }
  }
}
