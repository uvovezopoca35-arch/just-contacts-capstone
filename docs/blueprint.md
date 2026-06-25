# **App Name**: Just Contacts

## Core Features:

- Telegram Authentication: Authenticate users via Telegram WebApp initData and Firebase Custom Auth, falling back to Google Auth in development environments.
- Neo-Brutalist Dashboard: Display a dashboard with a search bar, 'Social Pulse' widget (contacts to reconnect), 'Upcoming' widget (birthdays), and a recent contacts list.
- AI-Powered Contact Parsing: Use Google Gemini 1.5 Flash via Cloud Functions to extract contact details (name, role, tags, summary) from voice input.
- Contact Profile Dossier: Present a contact profile with a large avatar, AI-generated summary (in sticky note style), quick action buttons, and an interaction timeline.
- Semantic Search with AI Tool: Use Gemini as a tool for semantic search across contacts, identifying relevant contacts based on user queries.
- Firestore Integration: Persist user profiles, contacts, and interaction history in Firestore with a NoSQL database structure for efficient data management.
- Voice Input for Contacts: Transcribe speech to text, analyze the result and automatically extract information for adding a new contact using Google Gemini

## Style Guidelines:

- Primary color: Electric Blue (#3B82F6) for primary actions.
- Background color: Near-white (#F0F2F5) to offer sufficient contrast, while softening the starkness of pure white.
- Accent color: Hot Pink (#EC4899) for alerts and voice trigger highlights.
- Font: 'Inter' sans-serif for both headings and body text to maintain a clean, readable, modern appearance. Note: currently only Google Fonts are supported.
- Borders: 2px black borders on all containers, buttons, and inputs.
- Shadows: Hard shadows (4px offset, no blur) on all elements.
- Radius: Rounded corners (xl for cards, full for buttons).
- Framer Motion: Spring physics for smooth pop-up effects.