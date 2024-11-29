import express from 'express';
import { Groq } from 'groq-sdk';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import FormData from 'form-data';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy - required for rate limiting behind reverse proxies (like on Vercel)
app.set('trust proxy', 1);

// Initialize Groq
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res) => {
        res.status(429).json({
            error: 'Too many requests, please try again later.'
        });
    }
});

// Store chat history (in memory - consider using a database for production)
const chatHistory = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(limiter);

// Configure multer to use memory storage instead of disk storage
const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Function to generate speech
async function generateSpeech(text, voiceSettings = {}, voiceId) {
    try {
        const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVEN_LABS_API_KEY
            },
            body: JSON.stringify({
                text,
                model_id: "eleven_monolingual_v1",
                voice_settings: {
                    stability: voiceSettings.stability || 0.5,
                    similarity_boost: voiceSettings.similarity_boost || 0.5
                }
            })
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        const audioBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');
        return `data:audio/mpeg;base64,${base64Audio}`;
    } catch (error) {
        console.error('Error generating speech:', error);
        return null;
    }
}

// Voice mappings for different roles
const roleToVoice = {
    'lawyer': 'ErXwobaYiN019PkySvjV', // Josh
    'doctor': 'EXAVITQu4vr4xnSDxMaL', // Bella
    'tutor': '21m00Tcm4TlvDq8ikWAM', // Rachel
    'engineer': 'VR6AewLTigWG4xSOukaG', // Adam
    'financial': 'EXAVITQu4vr4xnSDxMaL', // Bella
    'writer': '21m00Tcm4TlvDq8ikWAM', // Rachel
    'tax': 'ErXwobaYiN019PkySvjV' // Josh
};

// Preset prompts for different roles
const presetPrompts = {
    'lawyer': {
        name: 'Saul Goodman',
        system: "You are Saul Goodman. Keep responses under 50 words. Be direct and witty. Use 'Better Call Saul' catchphrase occasionally. Focus on practical legal advice while maintaining your signature charm."
    },
    'doctor': {
        name: 'Dr. Sarah Chen',
        system: "You are Dr. Sarah Chen. Keep responses under 50 words. Provide clear, concise medical information. Be professional yet compassionate. Focus on practical health guidance."
    },
    'tutor': {
        name: 'Professor Alex Thompson',
        system: "You are Professor Alex Thompson. Keep responses under 50 words. Explain concepts clearly and simply. Use examples when needed. Focus on key learning points."
    },
    'engineer': {
        name: 'Dr. Michael Zhang',
        system: "You are Dr. Michael Zhang. Keep responses under 50 words. Provide practical coding and technical advice. Use simple explanations for complex concepts."
    },
    'financial': {
        name: 'Emma Richardson',
        system: "You are Emma Richardson. Keep responses under 50 words. Give clear financial advice. Focus on practical money management tips. Emphasize important financial concepts briefly."
    },
    'writer': {
        name: 'Isabella Martinez',
        system: "You are Isabella Martinez. Keep responses under 50 words. Provide concise writing advice. Focus on key storytelling elements. Give practical tips for improvement."
    },
    'tax': {
        name: 'William Turner',
        system: "You are William Turner. Keep responses under 50 words. Provide clear tax advice. Focus on compliance and optimization. Explain complex tax concepts simply."
    }
};

// Initialize chat sessions with role-specific context
app.post('/init', async (req, res) => {
    try {
        const { role, sessionId } = req.body;
        
        if (!role || !presetPrompts[role]) {
            return res.status(400).json({ error: 'Invalid role specified' });
        }

        // Clear existing chat history for this session
        chatHistory.set(sessionId, []);

        // Get the role configuration
        const roleConfig = presetPrompts[role];

        // Create initial message array with system prompt
        const messages = [
            {
                role: "system",
                content: roleConfig.system
            },
            {
                role: "user",
                content: "Hello, could you introduce yourself?"
            }
        ];

        try {
            // Get response from Groq
            const chatCompletion = await groq.chat.completions.create({
                messages: messages,
                model: "llama-3.1-70b-versatile",
                temperature: 0.7,
                max_tokens: 1024
            });

            let botResponse = chatCompletion.choices[0].message.content;
            
            // Clean up markdown formatting
            botResponse = botResponse.replace(/\*\*/g, '').replace(/\*/g, '');

            // Store in chat history
            chatHistory.set(sessionId, [
                { role: "system", content: roleConfig.system },
                { role: "user", content: "Hello, could you introduce yourself?" },
                { role: "assistant", content: botResponse }
            ]);

            // Generate audio if needed
            let audioData = null;
            if (roleToVoice[role]) {
                try {
                    audioData = await generateSpeech(botResponse, {}, roleToVoice[role]);
                } catch (error) {
                    console.error('Error generating speech:', error);
                }
            }

            res.json({
                message: botResponse,
                audioData: audioData
            });
        } catch (error) {
            console.error('Error in chat completion:', error);
            res.status(500).json({ error: 'Error initializing AI role. Please try again.' });
        }
    } catch (error) {
        console.error('Error in /init:', error);
        res.status(500).json({ error: 'Error initializing chat session' });
    }
});

// Chat endpoint with history
app.post('/chat', async (req, res) => {
    try {
        const { message, sessionId, voiceSettings, voiceId, selectedRole, ttsEnabled } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get chat history for this session
        const history = chatHistory.get(sessionId) || [];

        // Get role configuration
        const roleConfig = selectedRole && presetPrompts[selectedRole] 
            ? presetPrompts[selectedRole]
            : presetPrompts['lawyer']; // Default to Saul Goodman

        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: roleConfig.system + " Always be concise and direct." },
                    ...history.slice(-4), // Keep only last 2 exchanges for context
                    { role: "user", content: message }
                ],
                model: "mixtral-8x7b-32768",
                temperature: 0.7,
                max_tokens: 100, // Limit token length
                top_p: 1,
                stream: false
            });

            const reply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";

            // Update chat history (keep only last 3 exchanges)
            history.push({ role: "user", content: message });
            history.push({ role: "assistant", content: reply });
            chatHistory.set(sessionId, history.slice(-6));

            // Generate speech if TTS is enabled
            let audioUrl = null;
            if (ttsEnabled && voiceId) {
                try {
                    audioUrl = await generateSpeech(reply, voiceSettings, voiceId);
                } catch (error) {
                    console.error('Speech generation error:', error);
                }
            }

            res.json({ reply, audioUrl });
        } catch (error) {
            console.error('Groq API error:', error);
            
            if (error.message && error.message.includes('rate limit exceeded')) {
                return res.status(429).json({
                    error: "Rate limit reached. Please try again in a few minutes.",
                    retryAfter: 60
                });
            }
            
            res.status(500).json({
                error: "Service temporarily unavailable. Please try again.",
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'An unexpected error occurred' });
    }
});

// Voice settings endpoint
app.post('/voice-settings', (req, res) => {
    const { stability, similarity_boost } = req.body;
    if (stability < 0 || stability > 1 || similarity_boost < 0 || similarity_boost > 1) {
        return res.status(400).json({ error: 'Values must be between 0 and 1' });
    }
    res.json({ status: 'Settings updated' });
});

// Clear chat history
app.post('/clear-history', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) {
        chatHistory.delete(sessionId);
    }
    res.json({ status: 'History cleared' });
});

// Transcribe endpoint - using your existing setup
app.post('/transcribe', uploadMiddleware.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // Create form data with the audio buffer
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: 'audio.webm',
            contentType: req.file.mimetype
        });
        formData.append('model', 'whisper-1');

        const defaultText = "Audio received and processed";
        res.json({ text: defaultText });
    } catch (error) {
        console.error('Error processing audio:', error);
        res.status(500).json({ error: 'Error processing audio file' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
