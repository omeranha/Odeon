"""Fetches a YouTube Music song's audio straight from YouTube's player API, so downloads and streams skip yt-dlp.

yt-dlp spends about 18 s before the first byte (page, JavaScript challenge, a 3 s ad wait). This asks the same player API
for the audio and has the file in about a second. It replaces the audio fetch of library downloads (Downloader.fetch_audio)
and of the stream cache Downtify plays songs from (StreamCache._fetch). Anything unexpected returns None, and Downtify's own
fetch_audio (yt-dlp, with cookies) runs as before.

The client definitions are copied from yt-dlp's INNERTUBE_CLIENTS (extractor/youtube/_base.py) and must be kept in step
with server/src/innertube.ts in Odeon.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

from loguru import logger

PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false'
REQUEST_TIMEOUT = 15
DOWNLOAD_TIMEOUT = 60
VISITOR_TTL = 12 * 60 * 60
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')

ANDROID_VR_AGENT = 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip'
VISIONOS_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
# ANDROID_VR is left out: its links answer 403 to Python's connections (yt-dlp hits the same), while Node's are accepted.
CLIENTS = [
    {
        'name': 'VISIONOS',
        'id': 101,
        'agent': VISIONOS_AGENT,
        'context': {'clientName': 'VISIONOS', 'clientVersion': '1.02', 'deviceMake': 'Apple', 'deviceModel': 'RealityDevice17,1', 'userAgent': VISIONOS_AGENT, 'osName': 'visionOS', 'osVersion': '26.5.23O471', 'hl': 'en'},
    },
]

_visitor: dict[str, Any] = {'at': 0.0, 'value': None}
_visitor_lock = threading.Lock()


def _headers(client: dict[str, Any], visitor: Optional[str]) -> dict[str, str]:
    headers = {
        'Content-Type': 'application/json',
        'User-Agent': client['agent'],
        'X-YouTube-Client-Name': str(client['id']),
        'X-YouTube-Client-Version': client['context']['clientVersion'],
    }
    if visitor:
        headers['X-Goog-Visitor-Id'] = visitor
    return headers


def _post(url: str, client: dict[str, Any], visitor: Optional[str], body: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=_headers(client, visitor), method='POST')
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        return json.loads(response.read())


def _visitor_data() -> Optional[str]:
    with _visitor_lock:
        if _visitor['value'] and time.time() - _visitor['at'] < VISITOR_TTL:
            return _visitor['value']
        client = CLIENTS[0]
        try:
            data = _post(BROWSE_URL, client, None, {'context': {'client': client['context']}, 'browseId': 'FEwhat_to_watch'})
        except Exception:
            return None
        value = (data.get('responseContext') or {}).get('visitorData')
        if value:
            _visitor.update(at=time.time(), value=value)
        return value


def _best_aac(client: dict[str, Any], video_id: str) -> Optional[dict[str, Any]]:
    visitor = _visitor_data()
    context = {**client['context'], **({'visitorData': visitor} if visitor else {})}
    body = {
        'context': {'client': context},
        'videoId': video_id,
        'contentCheckOk': True,
        'racyCheckOk': True,
        'playbackContext': {'contentPlaybackContext': {'html5Preference': 'HTML5_PREF_WANTS'}},
    }
    data = _post(PLAYER_URL, client, visitor, body)
    if (data.get('playabilityStatus') or {}).get('status') != 'OK':
        return None
    formats = [
        item
        for item in (data.get('streamingData') or {}).get('adaptiveFormats') or []
        if item.get('url') and 'mp4a' in (item.get('mimeType') or '') and int(item.get('contentLength') or 0) > 0
    ]
    return max(formats, key=lambda item: item.get('bitrate') or 0, default=None)


def _download(url: str, agent: str, size: int, destination: str, on_progress: Callable[[float], None]) -> bool:
    request = urllib.request.Request(url, headers={'User-Agent': agent, 'Range': 'bytes=0-'})
    received = 0
    with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT) as response, open(destination, 'wb') as output:
        while chunk := response.read(256 * 1024):
            output.write(chunk)
            received += len(chunk)
            on_progress(received / size)
    # A preview-only stream ends early, so a short file is never filed as the song.
    return received == size


def fetch(video_id: str, target_dir: Path, basename: str, progress: Callable[[float, str], None]) -> Optional[Path]:
    if not VIDEO_ID.match(video_id):
        return None
    for client in CLIENTS:
        try:
            chosen = _best_aac(client, video_id)
        except Exception as error:
            logger.debug('fast fetch: {} failed for {}: {}', client['name'], video_id, error)
            continue
        if not chosen:
            continue
        size = int(chosen['contentLength'])
        raw = tempfile.NamedTemporaryFile(prefix='fast-', suffix='.mp4', delete=False)
        raw.close()
        final = target_dir / f'{basename}.m4a'
        partial = target_dir / f'{basename}.m4a.part'
        try:
            if not _download(chosen['url'], client['agent'], size, raw.name, lambda share: progress(share * 90, 'Downloading')):
                logger.debug('fast fetch: {} served a partial file for {}', client['name'], video_id)
                continue
            progress(96.0, 'Converting')
            # YouTube's DASH audio is fragmented; one copy pass makes it an ordinary m4a that taggers and Navidrome read.
            # The result is renamed into place so nothing reads a half-written file.
            subprocess.run(
                ['ffmpeg', '-loglevel', 'error', '-y', '-i', raw.name, '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'ipod', str(partial)],
                check=True,
                timeout=120,
            )
            if partial.stat().st_size < 50_000:
                continue
            os.replace(partial, final)
            return final
        except Exception as error:
            logger.debug('fast fetch: {} failed for {}: {}', client['name'], video_id, error)
        finally:
            os.unlink(raw.name)
            partial.unlink(missing_ok=True)
    return None


def install() -> None:
    from downtify.downloader import Downloader

    original = Downloader.fetch_audio

    def fetch_audio(self, video_id, target_dir, basename, *, song, progress_cb=None, provider=None, audio_format=None):
        if (audio_format or self.audio_format) == 'original':

            def report(percent: float, label: str) -> None:
                if progress_cb:
                    try:
                        progress_cb(percent, label, provider)
                    except Exception:
                        pass

            started = time.time()
            found = fetch(video_id, Path(target_dir), basename, report)
            if found:
                logger.info('fast fetch: {} in {:.1f}s', video_id, time.time() - started)
                return found
            logger.info('fast fetch: {} not available, using yt-dlp', video_id)
        return original(self, video_id, target_dir, basename, song=song, progress_cb=progress_cb, provider=provider, audio_format=audio_format)

    Downloader.fetch_audio = fetch_audio

    from downtify.stream import StreamCache

    original_stream_fetch = StreamCache._fetch

    def stream_fetch(self, video_id, cookies_file):
        started = time.time()
        found = fetch(video_id, Path(self._dir), video_id, lambda *_: None)
        if found:
            logger.info('fast fetch: {} cached for streaming in {:.1f}s', video_id, time.time() - started)
            return None
        return original_stream_fetch(self, video_id, cookies_file)

    StreamCache._fetch = stream_fetch
