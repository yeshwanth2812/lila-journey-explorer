// Optional. Trailscope's assistant works without this file's settings.
// To let it answer free-form questions with an LLM, point `endpoint` at YOUR OWN small proxy that
// holds the API key server-side (never put a key in this file). The page POSTs
// { question, view: {map, lens, days, pins}, stats } and expects { answer: "text" } back.
window.TRAILSCOPE_AI = { endpoint: '' };
