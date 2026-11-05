/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import * as cheerio from 'cheerio';

// Get Spotify token
async function getSpotifyToken(env) {
	const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = env;

	const token = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);

	const response = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			'Authorization': `Basic ${token}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials'
	});

	const data = await response.json();
	return data.access_token;
}

// Scrape Apple Music metadata
async function getAppleMetadata(link) {
	const response = await fetch(link);
	const html = await response.text();
	const $ = cheerio.load(html);

	const jsonLdScript = $('#schema\\:song').html(); // Escape colon for ID selector
	const jsonLd = JSON.parse(jsonLdScript);

	const title = jsonLd.name;
	const artists = jsonLd.audio.byArtist.map(artist => artist.name);

	return { title, artists };
}

// Search Spotify
async function searchSpotify(title, artists, token) {
	const query = encodeURIComponent(`${title} ${artists.join(",")}`);
	const url = `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`;

	const response = await fetch(url, {
		headers: {
			'Authorization': `Bearer ${token}`,
		}
	});

	const data = await response.json();
	const items = data.tracks.items;
	if (items.length === 0) return null;

	//uri generating
	let parts = items[0].external_urls.spotify.split("/");
	let type = parts[3];
	let id = parts[4].split("?")[0];
	let uri = "spotify:" + type + ":" + id;

	return [items[0].external_urls.spotify, uri];
}

// Worker handler
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const appleLink = url.searchParams.get('link');
		const retLinkType = url.searchParams.get('type');

		if (!appleLink || !appleLink.includes('music.apple.com')) {
			return new Response('Invalid or missing Apple Music link.', { status: 400 });
		}

		try {
			const { title, artists } = await getAppleMetadata(appleLink);
			const token = await getSpotifyToken(env);
			const [spotifyUrl, uri] = await searchSpotify(title, artists, token);

			if (spotifyUrl) {
				return Response.redirect(retLinkType === "uri" ? uri: spotifyUrl, 302);
			} else {
				return new Response(`Could not find "${title}" by "${artists.join(", ")}" on Spotify.`, { status: 404 });
			}
		} catch (err) {
			console.error(err);
			return new Response('An error occurred.', { status: 500 });
		}
	}
};
