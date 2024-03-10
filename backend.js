const express = require('express');
const ytdl = require('ytdl-core');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

ffmpeg.setFfmpegPath(ffmpegPath);

// Serve static files from the "public" directory
app.use(express.static('public'));

app.get('/download', async (req, res) => {
    try {
        const videoUrl = req.query.videoUrl;
        const resolution = req.query.resolution || 'highest';
        const audioOnly = req.query.audioOnly === 'true';

        // Check if video URL is provided
        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            throw new Error('Invalid YouTube video URL');
        }

        // Get video info
        const info = await ytdl.getInfo(videoUrl);

        // Render HTML with loading animation
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Downloading...</title>
                <link rel="stylesheet" type="text/css" href="styles.css">
            </head>
            <body>
            <div class="download-container">
            <div class="spinner"></div>
            <div class="message">Downloading...</div>
          </div>
                <script>
                    setTimeout(function(){
                        window.location.href = "/download-start?videoUrl=${encodeURIComponent(videoUrl)}&resolution=${encodeURIComponent(resolution)}&audioOnly=${audioOnly}";
                    }, 2000); // Redirect after 2 seconds
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(400).send(error.message);
    }
});

app.get('/download-start', async (req, res) => {
    try {
        const videoUrl = decodeURIComponent(req.query.videoUrl);
        const resolution = decodeURIComponent(req.query.resolution);
        const audioOnly = req.query.audioOnly === 'true';

        // Get video info
        const info = await ytdl.getInfo(videoUrl);

        // If audio only is selected, download just the audio
        if (audioOnly) {
            const audioFormat = ytdl.chooseFormat(info.formats, { filter: 'audioonly' });

            if (!audioFormat) {
                throw new Error('Audio format not found');
            }

            const audioFilePath = `./temp/audio_${Date.now()}.mp3`;

            await new Promise((resolve, reject) => {
                ytdl(videoUrl, { format: audioFormat })
                    .pipe(fs.createWriteStream(audioFilePath))
                    .on('finish', resolve)
                    .on('error', reject);
            });

            // Set response headers
            res.header('Content-Disposition', `attachment; filename="${info.videoDetails.title}.mp3"`);
            res.header('Content-Type', 'audio/mp3');

            // Pipe audio stream to response
            fs.createReadStream(audioFilePath).pipe(res);

            // Delete temporary audio file after response is sent
            res.on('finish', () => {
                deleteFile(audioFilePath);
            });
        } else {
            // Get the available formats
            const formats = ytdl.filterFormats(info.formats, 'videoonly');

            // Find the format based on resolution
            const format = formats.find(format => format.qualityLabel === resolution);

            // If the format is not found, default to the highest available quality
            const selectedFormat = format || formats.find(format => format.qualityLabel === 'highest');

            // Download video and audio separately
            const videoFilePath = `./temp/video_${Date.now()}.mp4`;
            const audioFilePath = `./temp/audio_${Date.now()}.mp3`;

            await Promise.all([
                new Promise((resolve, reject) => {
                    ytdl(videoUrl, { format: selectedFormat })
                        .pipe(fs.createWriteStream(videoFilePath))
                        .on('finish', resolve)
                        .on('error', reject);
                }),
                new Promise((resolve, reject) => {
                    ytdl(videoUrl, { filter: 'audioonly' })
                        .pipe(fs.createWriteStream(audioFilePath))
                        .on('finish', resolve)
                        .on('error', reject);
                })
            ]);

            // Merge video and audio using ffmpeg
            const mergedFilePath = `./temp/merged_${Date.now()}.mp4`;

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(videoFilePath)
                    .input(audioFilePath)
                    .outputOptions('-c:v copy')
                    .outputOptions('-c:a aac')
                    .output(mergedFilePath)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            // Set response headers
            res.header('Content-Disposition', `attachment; filename="${info.videoDetails.title}.mp4"`);
            res.header('Content-Type', 'video/mp4');

            // Pipe merged video to response
            fs.createReadStream(mergedFilePath).pipe(res);

            // Delete temporary files after response is sent
            res.on('finish', () => {
                deleteFile(videoFilePath);
                deleteFile(audioFilePath);
                deleteFile(mergedFilePath);
            });
        }
    } catch (error) {
        res.status(400).send(error.message);
    }
});

function deleteFile(filePath) {
    fs.unlink(filePath, err => {
        if (err) {
            console.error(`Error deleting file ${filePath}: ${err}`);
        } else {
            console.log(`Deleted file: ${filePath}`);
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
