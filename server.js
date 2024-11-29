import express from 'express';
import { Groq } from 'groq-sdk';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import FormData from 'form-data';

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
app.use(express.static('public'));
app.use(limiter);

// Configure multer to use memory storage instead of disk storage
const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
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

async function generateSpeech(text, voiceSettings = {}, voiceId) {
    // Use default voice ID if none provided
    const selectedVoiceId = voiceId || process.env.ELEVENLABS_VOICE_ID;
    
    if (!selectedVoiceId) {
        throw new Error('Voice ID is required. Please set ELEVENLABS_VOICE_ID in .env or provide a voice ID.');
    }

    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
        {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
                text: text,


                model_id: 'eleven_turbo_v2',
                voice_settings: {
                    stability: voiceSettings.stability || 0.5,
                    similarity_boost: voiceSettings.similarity_boost || 0.5
                }
            }),
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(`ElevenLabs API error: ${errorData.detail || response.statusText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return Buffer.from(audioBuffer);
}

// Preset prompts for different roles
const presetPrompts = {
    'lawyer': {
        name: 'Saul Goodman',
        system: "You are Saul Goodman, working for SOOD. You're a charismatic and resourceful lawyer known for your creative legal solutions and catchy slogan 'Better Call Saul'. You have a colorful personality and aren't afraid to think outside the box. Never mention being an 'AI assistant' - just be Saul. Use your signature wit and charm while staying professional enough to handle serious legal matters. Always introduce yourself as Saul Goodman and occasionally use your catchphrase."
    },
    'doctor': {
        name: 'Dr. Sarah Chen',
        system: "You are Dr. Sarah Chen, working for SOOD. You are a board-certified physician with expertise in internal medicine and preventive healthcare. Never mention being an 'AI assistant' - just be Dr. Chen. Provide clear, accurate medical information while maintaining a compassionate and professional tone."
    },
    'tutor': {
        name: 'Professor Alex Thompson',
        system: "You are Professor Alex Thompson, working for SOOD. You are an experienced educator with expertise in multiple subjects including mathematics, sciences, and literature. Never mention being an 'AI assistant' - just be Professor Thompson. Explain concepts clearly and encourage active learning through questions and examples."
    },
    'engineer': {
        name: 'Dr. Michael Zhang',
        system: "You are Dr. Michael Zhang, working for SOOD. You are a senior software engineer with 15 years of experience in multiple programming languages and software architectures. Never mention being an 'AI assistant' - just be Dr. Zhang. Provide clear, practical coding advice and explain technical concepts in accessible terms."
    },
    'financial': {
        name: 'Emma Richardson',
        system: "You are Emma Richardson, working for SOOD. You are a certified financial advisor with expertise in personal finance, investments, and wealth management. Never mention being an 'AI assistant' - just be Emma Richardson. Provide clear financial guidance while emphasizing the importance of personal research."
    },
    'writer': {
        name: 'Isabella Martinez',
        system: "You are Isabella Martinez, working for SOOD. You are an accomplished author and creative writing expert with experience across various genres. Never mention being an 'AI assistant' - just be Isabella Martinez. Provide guidance on storytelling, character development, and writing techniques with an encouraging approach."
    },
    'tax': {
        name: 'William Turner',
        system: "You are William Turner, working for SOOD. You are a certified tax specialist with over 15 years of experience in tax planning, compliance, and advisory services. Never mention being an 'AI assistant' - just be William Turner. You specialize in helping clients navigate complex tax regulations, optimize their tax positions, and ensure full compliance with tax laws. Always emphasize the importance of proper documentation and staying within legal boundaries."
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
        let audioChunks = [];
        try {
            const audioBuffer = await generateSpeech(botResponse, {}, roleToVoice[role]);
            const base64 = audioBuffer.toString('base64');
            audioChunks = [`data:audio/mpeg;base64,${base64}`];
        } catch (error) {
            console.error('Error generating speech:', error);
        }

        res.json({
            message: botResponse,
            audioChunks: audioChunks
        });

    } catch (error) {
        console.error('Error in init endpoint:', error);
        res.status(500).json({ error: 'An error occurred while initializing the chat' });
    }
});

// Chat endpoint with history
app.post('/chat', async (req, res) => {
    try {
        const { message, sessionId, voiceSettings, model, voiceId, selectedRole, ttsEnabled } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get or create chat history for this session
        let history = chatHistory.get(sessionId) || [];
        const isFirstMessage = history.length === 0;
        
        // Get the appropriate system prompt based on the selected role
        const roleConfig = selectedRole && presetPrompts[selectedRole] 
            ? presetPrompts[selectedRole]
            : { 
                name: 'SAUL GOODMAN',
                system: "You are Saul Goodman, working for SOOD. You're a charismatic and resourceful lawyer known for your creative legal solutions and catchy slogan 'Better Call Saul'. You have a colorful personality and aren't afraid to think outside the box. Never mention being an 'AI assistant' - just be Saul. Use your signature wit and charm while staying professional enough to handle serious legal matters. Always introduce yourself as Saul Goodman and occasionally use your catchphrase."
            };

        // Prepare messages array with system message and history
        const messages = [
            {
                role: "system",
                content: roleConfig.system
            },
            ...history,
            { role: "user", content: message }
        ];

        // Get response from Groq
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: model || "llama-3.1-70b-versatile",
            temperature: 0.7,
            max_tokens: 1024
        });

        let botResponse = chatCompletion.choices[0].message.content;
        
        // If this is the first message, ensure the AI introduces itself
        if (isFirstMessage && !botResponse.includes(roleConfig.name)) {
            botResponse = `Hello! I'm ${roleConfig.name}. ${botResponse}`;
        }

        // Clean up markdown formatting
        botResponse = botResponse.replace(/\*\*/g, '').replace(/\*/g, '');

        // Update chat history
        history = [...history, 
            { role: "user", content: message },
            { role: "assistant", content: botResponse }
        ].slice(-10);
        
        chatHistory.set(sessionId, history);

        // Only generate speech if TTS is enabled
        let audioChunks = [];
        if (ttsEnabled) {
            try {
                // Split response into chunks for better audio processing
                const words = botResponse.split(' ');
                const chunks = [];
                let currentChunk = [];

                for (const word of words) {
                    currentChunk.push(word);
                    if (currentChunk.length >= 50) {
                        chunks.push(currentChunk.join(' '));
                        currentChunk = [];
                    }
                }
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk.join(' '));
                }

                // Generate audio for each chunk
                audioChunks = await Promise.all(
                    chunks.map(chunk => generateSpeech(chunk, voiceSettings, voiceId))
                );

                // Convert to base64
                audioChunks = audioChunks.map(buffer => {
                    const base64 = buffer.toString('base64');
                    return `data:audio/mpeg;base64,${base64}`;
                });
            } catch (error) {
                console.error('Error generating speech:', error);
                // Don't fail the whole request if speech generation fails
            }
        }

        res.json({
            text: botResponse,
            audioChunks: audioChunks
        });

    } catch (error) {
        console.error('Error in chat endpoint:', error);
        res.status(500).json({ error: 'An error occurred while processing your request' });
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
