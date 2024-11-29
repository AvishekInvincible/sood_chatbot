# SOOD - AI Expert Chat Assistant

SOOD is a modern, AI-powered chat application that provides expert consultations across various professional domains. Using Groq for natural language processing and ElevenLabs for voice synthesis, SOOD offers an interactive experience with different professional personas.

## Features

- **Multiple Expert Personas**: Chat with various professionals including:
  - Saul Goodman (Legal Expert)
  - Dr. Sarah Chen (Medical Professional)
  - Professor Alex Thompson (Educational Tutor)
  - Dr. Michael Zhang (Software Engineer)
  - Emma Richardson (Financial Advisor)
  - Isabella Martinez (Writing Expert)
  - William Turner (Tax Specialist)

- **Voice Interaction**:
  - Text-to-Speech capability using ElevenLabs
  - Toggle audio on/off to manage API usage
  - Stop audio playback control

- **Modern UI/UX**:
  - Clean, minimalistic design
  - Responsive layout
  - Smooth animations
  - Professional styling

## Tech Stack

- Backend: Node.js with Express
- Frontend: HTML, CSS, JavaScript
- AI: Groq API
- Voice Synthesis: ElevenLabs API

## Setup

1. Clone the repository:
```bash
git clone https://github.com/AvishekInvincible/sood_chatbot.git
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your API keys:
```
GROQ_API_KEY=your_groq_api_key
ELEVEN_LABS_API_KEY=your_elevenlabs_api_key
```

4. Start the server:
```bash
npm start
```

5. Access the application at `http://localhost:3000`

## Environment Variables

- `GROQ_API_KEY`: Your Groq API key for AI responses
- `ELEVEN_LABS_API_KEY`: Your ElevenLabs API key for voice synthesis

## Usage

1. Select an expert persona from the dropdown menu
2. Toggle Text-to-Speech if you want voice responses
3. Type your message and press send
4. Interact with the AI expert naturally

## Security

- API keys are stored securely in environment variables
- No sensitive data is stored or logged
- All communication is handled server-side

## License

MIT License - feel free to use and modify as needed.
