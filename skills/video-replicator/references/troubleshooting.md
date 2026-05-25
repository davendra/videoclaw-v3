# Troubleshooting Guide

Common issues and solutions for the Video Replicator skill.

## Video Generation Issues

### Rate Limiting (0% Timeout)

**Symptom**: Video generation hangs at 0% or times out after several minutes.

**Cause**: Google Flow rate limits when too many parallel generations run simultaneously.

**Solution**:
```bash
# Use max 2 parallel workers (default)
python parallel_video_gen.py --product my-product --max-workers 2 --scenes '...'

# Or run sequentially for safest approach
python parallel_video_gen.py --product my-product --max-workers 1 --scenes '...'
```

### Frame Not Attaching (Frames-to-Video Mode)

**Symptom**: Video generates but doesn't use the provided first frame.

**Causes & Solutions**:

1. **Wrong image format**: Use JPG or PNG only
   ```bash
   # Convert WebP to PNG if needed
   convert scene_1_frame.webp scene_1_frame.png
   ```

2. **File naming**: Must be `scene_N_frame.{jpg|png}`
   ```
   ✓ scene_1_frame.jpg
   ✓ scene_5_frame.png
   ✗ scene1.jpg
   ✗ frame_scene_1.jpg
   ```

3. **Path not found**: Use absolute paths or correct relative paths
   ```bash
   # Verify with dry-run
   python parallel_video_gen.py --dry-run --mode frames-to-video \
     --images-dir projects/my-product/images --scenes '{"1":"test"}'
   ```

### Video Not Downloading

**Symptom**: Generation completes but no video file appears.

**Causes & Solutions**:

1. **Browser instance collision**: Each instance needs isolated downloads directory
   - Check that `downloads-{instance_id}/` exists in flow-video-generator
   - Verify FLOW_INSTANCE_ID environment variable is set

2. **Download blocked**: Check browser permissions
   ```bash
   # Clear browser state and retry
   rm -rf /path/to/flow-video-generator/.auth-state-*.json
   ```

3. **Disk space**: Ensure sufficient storage
   ```bash
   df -h .
   ```

## Image Generation Issues

### Go Bananas Not Responding

**Symptom**: MCP tools timeout or return errors.

**Solutions**:
1. Check MCP server is running
2. Verify API connectivity
3. Try simpler prompt first to test connection

### Character Inconsistency

**Symptom**: Character looks different across scenes.

**Solutions**:
1. Use character references with `generate_with_character`
2. Include consistent clothing/feature descriptions in each prompt
3. Generate all scenes in same session for consistency

## Audio Generation Issues

### Music Generation Fails

**Symptom**: `generate_music.py` returns error or empty file.

**Causes & Solutions**:

1. **Missing API key**:
   ```bash
   # Check .env file
   grep KIE_API_KEY .env

   # Should show:
   KIE_API_KEY=your_key_here
   ```

2. **Invalid prompt**: Keep music prompts simple
   ```
   ✓ "Upbeat electronic, 120 BPM, energetic"
   ✗ "Create a complex orchestral piece with 47 instruments"
   ```

3. **Duration too long**: Limit to 60 seconds max initially

### Audio Sync Issues

**Symptom**: Music doesn't match video length.

**Solution**: Specify exact duration matching video length
```bash
# Get video duration first
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.mp4

# Generate music with matching duration
python generate_music.py --duration 32 --prompt "..." --output audio.mp3
```

## Video Analysis Issues

### Analysis Returns Empty/Incomplete

**Symptom**: SEALCAM analysis missing scenes or details.

**Solutions**:

1. **Video too long**: Trim to under 60 seconds
   ```bash
   ffmpeg -i long_video.mp4 -t 60 -c copy short_video.mp4
   ```

2. **Low quality video**: Use at least 720p source

3. **API quota**: Check Gemini API quota in Google Cloud Console

### Wrong Scene Segmentation

**Symptom**: Scenes split incorrectly or merged.

**Solutions**:
1. Manually review and adjust the JSON output
2. For fast-cut videos, may need manual scene timestamps
3. Use videos with clear scene transitions

## Stitching Issues

### FFmpeg Errors

**Symptom**: `stitch_video.py` fails with codec errors.

**Solutions**:

1. **Mismatched resolutions**: All videos must be same resolution
   ```bash
   # Check video resolution
   ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 scene_1.mp4

   # Resize if needed
   ffmpeg -i scene_1.mp4 -vf scale=1280:720 -c:a copy scene_1_720p.mp4
   ```

2. **Mismatched frame rates**: Normalize frame rates
   ```bash
   ffmpeg -i scene_1.mp4 -r 30 -c:a copy scene_1_30fps.mp4
   ```

3. **Missing FFmpeg**: Install via Homebrew
   ```bash
   brew install ffmpeg
   ```

## Environment Issues

### Flow Generator Not Found

**Symptom**: "Flow generator not found" error.

**Solution**: Set correct path
```bash
# Option 1: Environment variable
export FLOW_GENERATOR_PATH=/path/to/flow-video-generator

# Option 2: Command line argument
python parallel_video_gen.py --flow-path /path/to/flow-video-generator ...
```

### Python Import Errors

**Symptom**: ModuleNotFoundError for required packages.

**Solution**:
```bash
pip install -r requirements.txt
```

### Node.js Version Issues

**Symptom**: Flow generator fails with syntax errors.

**Solution**: Ensure Node.js 18+
```bash
node --version  # Should be v18.x or higher
nvm use 18      # If using nvm
```

## Debugging Tips

### Enable Verbose Output

```bash
# Dry run to validate inputs
python parallel_video_gen.py --dry-run ...

# Check Flow generator output
cd /path/to/flow-video-generator
npm run start -- --help
```

### Check Generated Files

```bash
# List all outputs
find projects/my-product -type f -name "*.mp4" -o -name "*.mp3" -o -name "*.json"

# Check video properties
ffprobe -v quiet -print_format json -show_format -show_streams video.mp4
```

### Review Logs

Flow generator logs appear in terminal. For persistent logging:
```bash
python parallel_video_gen.py ... 2>&1 | tee generation.log
```
