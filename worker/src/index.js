/**
 * give-me-x-video — Cloudflare Worker
 * X (Twitter) video downloader backend
 */

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
};

// ─── URL Parsing ──────────────────────────────────────────────

function extractTweetId(url) {
  try {
    // handle t.co short links
    if (url.includes('t.co/')) {
      return { needsRedirect: true };
    }

    // x.com/<user>/status/<id> or twitter.com/<user>/status/<id>
    const match = url.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
    if (match) return { id: match[1] };

    // bare tweet ID
    if (/^\d{10,}$/.test(url.trim())) {
      return { id: url.trim() };
    }

    return { error: 'invalid_url' };
  } catch {
    return { error: 'invalid_url' };
  }
}

// ─── Syndication API (Primary) ────────────────────────────────

function syndicateToken(tweetId) {
  return ((Number(tweetId) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, '');
}

async function fetchViaSyndication(tweetId) {
  const token = syndicateToken(tweetId);
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}`;

  const resp = await fetch(url, {
    headers: { 'User-Agent': UA },
  });

  if (!resp.ok) return null;
  return resp.json();
}

// ─── GraphQL API (Fallback) ──────────────────────────────────

let cachedGuestToken = null;

async function getGuestToken() {
  if (cachedGuestToken) return cachedGuestToken;

  const resp = await fetch('https://api.x.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  cachedGuestToken = data.guest_token;
  return cachedGuestToken;
}

async function fetchViaGraphQL(tweetId) {
  const guestToken = await getGuestToken();
  if (!guestToken) return null;

  const variables = JSON.stringify({
    focalTweetId: tweetId,
    with_rux_injections: false,
    rankingMode: 'Relevance',
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
  });

  const features = JSON.stringify({
    rweb_video_screen_enabled: false,
    payments_enabled: false,
    rweb_xchat_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    responsive_web_enhance_cards_enabled: false,
  });

  const fieldToggles = JSON.stringify({
    withArticleRichContentState: true,
    withArticlePlainText: false,
    withGrokAnalyze: false,
    withDisallowedReplyControls: false,
  });

  const gqlUrl = new URL('https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail');
  gqlUrl.searchParams.set('variables', variables);
  gqlUrl.searchParams.set('features', features);
  gqlUrl.searchParams.set('fieldToggles', fieldToggles);

  const resp = await fetch(gqlUrl.toString(), {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      'x-guest-token': guestToken,
      'content-type': 'application/json',
      'x-twitter-client-language': 'en',
      'x-twitter-active-user': 'yes',
      'accept-language': 'en',
      cookie: `guest_id=v1%3A${guestToken}`,
      'User-Agent': UA,
    },
  });

  if (resp.status === 403 || resp.status === 429) {
    cachedGuestToken = null;
    return null;
  }

  if (!resp.ok) return null;
  return resp.json();
}

function extractMediaFromGraphql(data) {
  try {
    const instructions =
      data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
    const addEntries = instructions.find((i) => i.type === 'TimelineAddEntries');
    if (!addEntries) return null;

    const tweetResult =
      addEntries.entries?.find((e) => e.entryId?.startsWith('tweet-'))
        ?.content?.itemContent?.tweet_results?.result;

    if (!tweetResult) return null;

    let baseTweet = tweetResult.legacy;
    if (tweetResult.__typename === 'TweetWithVisibilityResults') {
      baseTweet = tweetResult.tweet?.legacy;
    }

    // check for card-based video
    if (tweetResult.card?.legacy?.binding_values?.length) {
      const card = JSON.parse(
        tweetResult.card.legacy.binding_values[0].value?.string_value ||
          tweetResult.card.legacy.binding_values?.unified_card?.string_value ||
          '{}'
      );
      if (card.media_entities) {
        return Object.values(card.media_entities);
      }
    }

    const reposted = baseTweet?.retweeted_status_result?.result?.legacy
      ?.extended_entities;
    return reposted?.media || baseTweet?.extended_entities?.media || null;
  } catch {
    return null;
  }
}

function extractMediaFromSyndication(data) {
  if (data?.mediaDetails) return data.mediaDetails;

  if (data?.card) {
    try {
      const card = JSON.parse(
        data.card.binding_values?.unified_card?.string_value || '{}'
      );
      if (card.media_entities) return Object.values(card.media_entities);
    } catch {}
  }

  return null;
}

// ─── Media Processing ─────────────────────────────────────────

function pickBestMp4(variants) {
  if (!variants?.length) return null;
  return variants
    .filter((v) => v.content_type === 'video/mp4')
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
}

function formatMedia(mediaList) {
  if (!mediaList?.length) return [];

  return mediaList.map((item) => {
    if (item.type === 'photo') {
      return {
        type: 'photo',
        url: `${item.media_url_https}?name=4096x4096`,
        thumb: item.media_url_https,
      };
    }

    if (item.type === 'video' || item.type === 'animated_gif') {
      const best = pickBestMp4(item.video_info?.variants);
      const allMp4 = (item.video_info?.variants || [])
        .filter((v) => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      return {
        type: item.type,
        url: best?.url || null,
        thumb: item.media_url_https,
        bitrate: best?.bitrate || 0,
        duration: item.video_info?.duration_millis
          ? Math.round(item.video_info.duration_millis / 1000)
          : null,
        variants: allMp4.map((v) => ({
          url: v.url,
          bitrate: v.bitrate || 0,
          contentType: v.content_type,
        })),
      };
    }

    return null;
  }).filter(Boolean);
}

// ─── Main Resolve Handler ─────────────────────────────────────

async function handleResolve(request) {
  const reqUrl = new URL(request.url);
  const targetUrl = reqUrl.searchParams.get('url');

  if (!targetUrl) {
    return jsonResponse({ ok: false, error: 'missing url parameter' }, 400);
  }

  // handle t.co redirects
  let finalUrl = targetUrl;
  if (targetUrl.includes('t.co/')) {
    try {
      const redirectResp = await fetch(targetUrl, {
        redirect: 'follow',
        headers: { 'User-Agent': UA },
      });
      finalUrl = redirectResp.url;
    } catch {
      return jsonResponse({ ok: false, error: 'failed to resolve short url' }, 400);
    }
  }

  const parsed = extractTweetId(finalUrl);
  if (parsed.error) {
    return jsonResponse({ ok: false, error: parsed.error }, 400);
  }

  const tweetId = parsed.id;

  // try syndication first
  let media = null;
  let tweetInfo = null;

  try {
    const syndData = await fetchViaSyndication(tweetId);
    if (syndData) {
      media = extractMediaFromSyndication(syndData);
      tweetInfo = {
        id: tweetId,
        author: syndData.author?.screen_name || null,
        text: syndData.text || null,
      };
    }
  } catch {}

  // fallback to GraphQL
  if (!media) {
    try {
      const gqlData = await fetchViaGraphQL(tweetId);
      if (gqlData) {
        media = extractMediaFromGraphql(gqlData);
        if (!tweetInfo) {
          tweetInfo = { id: tweetId, author: null, text: null };
        }
      }
    } catch {}
  }

  if (!media?.length) {
    return jsonResponse({
      ok: false,
      error: 'no_media_found',
      message: 'No downloadable media found. The tweet may be private, deleted, or contain no video.',
    });
  }

  const formatted = formatMedia(media);

  return jsonResponse({
    ok: true,
    tweet: tweetInfo,
    media: formatted,
  });
}

// ─── Video Proxy ──────────────────────────────────────────────

async function handleProxy(request) {
  const reqUrl = new URL(request.url);
  const videoUrl = reqUrl.searchParams.get('url');

  if (!videoUrl) {
    return jsonResponse({ ok: false, error: 'missing url parameter' }, 400);
  }

  // validate it's a twitter video CDN URL
  if (
    !videoUrl.startsWith('https://video.twimg.com/') &&
    !videoUrl.startsWith('https://pbs.twimg.com/')
  ) {
    return jsonResponse({ ok: false, error: 'invalid proxy target' }, 400);
  }

  const fetchHeaders = { 'User-Agent': UA };

  // forward range header for video seeking
  const range = request.headers.get('Range');
  if (range) {
    fetchHeaders['Range'] = range;
  }

  const resp = await fetch(videoUrl, { headers: fetchHeaders });

  const responseHeaders = {
    ...CORS_HEADERS,
    'Content-Type': resp.headers.get('Content-Type') || 'video/mp4',
    'Cache-Control': 'public, max-age=86400',
  };

  const contentLength = resp.headers.get('Content-Length');
  if (contentLength) responseHeaders['Content-Length'] = contentLength;

  const contentRange = resp.headers.get('Content-Range');
  if (contentRange) responseHeaders['Content-Range'] = contentRange;

  return new Response(resp.body, {
    status: resp.status,
    headers: responseHeaders,
  });
}

// ─── JSON Response Helper ─────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

// ─── Router ───────────────────────────────────────────────────

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === '/api/resolve') {
        return await handleResolve(request);
      }

      if (url.pathname === '/api/proxy') {
        return await handleProxy(request);
      }

      // health check
      if (url.pathname === '/') {
        return jsonResponse({
          service: 'give-me-x-video',
          status: 'ok',
          endpoints: ['/api/resolve?url=<tweet_url>', '/api/proxy?url=<video_url>'],
        });
      }

      return jsonResponse({ ok: false, error: 'not_found' }, 404);
    } catch (err) {
      return jsonResponse({ ok: false, error: 'internal_error', message: err.message }, 500);
    }
  },
};
