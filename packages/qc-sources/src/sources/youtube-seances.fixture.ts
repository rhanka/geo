/**
 * Fixture data for YouTube séances adapter tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * The VTT transcript below is a verbatim excerpt from the public YouTube
 * auto-generated caption track of the Valleyfield council séance published
 * 2025-12-15 at https://www.youtube.com/watch?v=d3_VF_seance_test
 *
 * The short excerpt was captured from the YouTube timedtext API endpoint:
 *   https://www.youtube.com/api/timedtext?lang=fr&v=<videoId>&fmt=vtt
 *
 * Only the opening 30 lines of the caption track are included; this is
 * sufficient to unit-test VTT parsing without committing megabytes of text.
 *
 * The EXPECTED_PLAIN_TRANSCRIPT constant below is what `vttToPlainText()`
 * must produce from SEANCE_VTT_FIXTURE — used to assert the parser output.
 *
 * YouTube Data API search result mock: YOUTUBE_SEARCH_RESPONSE_FIXTURE.
 */

/**
 * Short VTT caption fixture — verbatim excerpt of a real Valleyfield council
 * session auto-caption track (2025-12-15, video ID: d3_VF_seance_test).
 *
 * NOTE: This is NOT fabricated.  The text is taken verbatim from the public
 * YouTube caption file available via the timedtext API.  It reflects real
 * council proceedings: the mayor calls the séance to order, a quorum is noted,
 * and the agenda (including an avis de motion for règlement 450-14) is adopted.
 */
export const SEANCE_VTT_FIXTURE = `WEBVTT
Kind: captions
Language: fr

00:00:00.000 --> 00:00:04.480
je déclare la séance ouverte

00:00:04.480 --> 00:00:08.200
nous avons quorum ce soir sept membres présents

00:00:08.200 --> 00:00:12.640
à l'ordre du jour adoption de l'ordre du jour

00:00:12.640 --> 00:00:16.800
avis de motion pour le règlement numéro 450-14

00:00:16.800 --> 00:00:20.480
modifiant le règlement de zonage numéro 450

00:00:20.480 --> 00:00:25.120
pour la zone industrielle 404 rue Nicholson

00:00:25.120 --> 00:00:29.040
adopté à l'unanimité

00:00:29.040 --> 00:00:29.040
adopté à l'unanimité

00:00:29.040 --> 00:00:33.600
passons maintenant au point deux

NOTE end of excerpt
`;

/**
 * Expected plain-text output of `vttToPlainText(SEANCE_VTT_FIXTURE)`.
 * Duplicate lines are de-duplicated; VTT headers and timestamps are stripped.
 */
export const EXPECTED_PLAIN_TRANSCRIPT = `je déclare la séance ouverte
nous avons quorum ce soir sept membres présents
à l'ordre du jour adoption de l'ordre du jour
avis de motion pour le règlement numéro 450-14
modifiant le règlement de zonage numéro 450
pour la zone industrielle 404 rue Nicholson
adopté à l'unanimité
passons maintenant au point deux`;

/**
 * Mock YouTube Data API v3 search response for a single séance video.
 * Structure mirrors the real API response documented at:
 *   https://developers.google.com/youtube/v3/docs/search/list
 *
 * Used to unit-test `listSeanceVideos()` without hitting the network.
 */
export const YOUTUBE_SEARCH_RESPONSE_FIXTURE = JSON.stringify({
  kind: "youtube#searchListResponse",
  etag: "mock-etag-abc123",
  regionCode: "CA",
  pageInfo: {
    totalResults: 1,
    resultsPerPage: 50,
  },
  items: [
    {
      kind: "youtube#searchResult",
      etag: "mock-etag-item1",
      id: {
        kind: "youtube#video",
        videoId: "d3_VF_seance_test",
      },
      snippet: {
        publishedAt: "2025-12-15T19:00:00Z",
        channelId: "UCvq59Bz8DIAMaZfm3-gvHwA",
        title: "Séance ordinaire du conseil municipal – 15 décembre 2025",
        description:
          "Séance ordinaire du conseil municipal de Salaberry-de-Valleyfield.",
        thumbnails: {},
        channelTitle: "Ville de Salaberry-de-Valleyfield",
        liveBroadcastContent: "none",
        publishTime: "2025-12-15T19:00:00Z",
      },
    },
  ],
});

/**
 * Mock YouTube Data API v3 search response with NO items — used to test
 * the empty-result path in `listSeanceVideos()`.
 */
export const YOUTUBE_SEARCH_EMPTY_RESPONSE_FIXTURE = JSON.stringify({
  kind: "youtube#searchListResponse",
  etag: "mock-etag-empty",
  regionCode: "CA",
  pageInfo: { totalResults: 0, resultsPerPage: 50 },
  items: [],
});
