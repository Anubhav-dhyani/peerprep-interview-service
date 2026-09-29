# PeerPrep Interview Service

This is a separate Node.js workspace for AI interview sessions. PeerPrep's main API owns login, interview authoring, publishing and resumes. This service owns the student interview session, ordered question plan, answer versions and chat transcript. Both services use the same persistent MongoDB database; there is no chat synchronization job or second copy of session data.

## Run

Use Node 20 or newer. Copy `.env.example` to `.env`, set `MONGODB_URI`, `INTERVIEW_SERVICE_SECRET`, `AI_PROVIDER`, `AI_API_KEY`, and the provider's model names, then run `npm install`, `npm run migrate:indexes` and `npm start`. The migration adds only the session indexes. Do not use `MONGODB_URI=memory` for deployment.

`AI_PROVIDER=gemini` uses the Gemini API for question generation, transcription, and speech. `AI_PROVIDER=openai` uses OpenAI for all three. Provider-specific legacy keys (`GEMINI_API_KEY` and `OPENAI_API_KEY`) remain supported, but `AI_API_KEY` is preferred. Switching providers requires only `.env` changes and a service restart.

On PeerPrep's main API set `INTERVIEW_SERVICE_URL` to this service's private HTTPS base URL and set the same `INTERVIEW_SERVICE_SECRET`. The browser continues to call PeerPrep at `/api/student/ai-interviews`; PeerPrep validates the student's login and forwards requests with a short-lived service token. Keep `/internal/ai-interviews` inaccessible from the public internet where possible. `/health` is a liveness endpoint.

The service reads published definitions and resumes from MongoDB when a student starts. It persists a plan and filtered resume context in `aiinterviewsessions`, so later edits do not change an in-progress interview.

## Voice interview flow

The student room on PeerPrep has no typed-answer box. Each question is spoken through `GET /internal/ai-interviews/sessions/:id/question-audio` using `AI_INTERVIEW_TTS_MODEL` (default `gpt-4o-mini-tts`) and `AI_INTERVIEW_VOICE` (default `coral`). The browser records up to three minutes, then sends WebM or MP4 microphone audio through PeerPrep to `POST /internal/ai-interviews/sessions/:id/transcribe`. The service uses `AI_INTERVIEW_TRANSCRIBE_MODEL` (default `gpt-transcribe`) and stores only the transcript as a pending answer, not the audio. The student can listen again, record again, or confirm the transcript. Only a current, confirmed recording can advance the interview; typed answer payloads are rejected. The transcript and question become a saved turn, and the existing topic/resume/follow-up logic selects the next question.

The recording limit is 8 MB and the pending transcript expires after 15 minutes. The student can refresh during that period and still confirm it. Microphone permission needs HTTPS or localhost. The 2D ANNU avatar is rendered in the PeerPrep frontend and its mouth follows question-audio volume; this is audio-reactive animation, not phoneme-accurate viseme lip sync. If audio generation fails, the question caption remains visible and playback can be retried by reloading the room.
