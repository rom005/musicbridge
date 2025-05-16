import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';

dotenv.config()

const app = express();
const PORT = process.env.PORT || 3000;

// Get Spotify token
async function getSpotifyToken() {
    const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
    const token = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post('https://accounts.spotify.com/api/token',
        'grant_type=client_credentials', {
            headers: {
                'Authorization': `Basic ${token}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        }
    );
    return response.data.access_token;
}

// Scrape Apple Music metadata
async function getAppleMetadata(link) {
    const response = await axios.get(link);
    const $ = cheerio.load(response.data);

    const jsonLdScript = $('#schema\\:song').html(); // Escape colon for ID selector
    const jsonLd = JSON.parse(jsonLdScript);

    const title = jsonLd.name;
    const artists = jsonLd.audio.byArtist.map(artist => artist.name);

    return { title, artists };
}

// Search Spotify
async function searchSpotify(title, artists, token) {
    const query = encodeURIComponent(`${title} ${artists.join(",")}`);
    console.log("query: ", query)
    const url = `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });

    const items = response.data.tracks.items;
    if (items.length === 0) return null;
    return items[0].external_urls.spotify;
}

// Main route
app.get('/', async (req, res) => {
    const appleLink = req.query.link;
    if (!appleLink || !appleLink.includes('music.apple.com')) {
        return res.status(400).send('Invalid or missing Apple Music link.');
    }

    try {
        const { title, artists } = await getAppleMetadata(appleLink);
        const token = await getSpotifyToken();
        const spotifyUrl = await searchSpotify(title, artists, token);

        if (spotifyUrl) {
            return res.redirect(spotifyUrl);
        } else {
            return res.status(404).send(`Could not find "${title}" by "${artist}" on Spotify.`);
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).send('An error occurred.');
    }
});

app.listen(PORT, () => {
    console.log(`MusicBridge running at http://localhost:${PORT}`);
});
