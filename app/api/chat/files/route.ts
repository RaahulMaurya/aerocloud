import { streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { listUserFilesAdmin } from '@/lib/storage-admin'
import { getAdminDb } from '@/lib/firebase-admin'

export const maxDuration = 30 // Allow streaming responses up to 30 seconds

export async function POST(req: Request) {
  try {
    const adminDb = getAdminDb()
    const { messages, userId, userContext } = await req.json()

    console.log('Chat API called with userId:', userId)

    // Check for API key
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      console.error('[Chat API] CRITICAL: Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable.')
      console.error('[Chat API] Please add GOOGLE_GENERATIVE_AI_API_KEY to your Vercel Environment Variables.')
      console.error('[Chat API] Get a key at: https://aistudio.google.com/app/apikey')
      return new Response(JSON.stringify({ error: 'AI service not configured. Please contact support.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 1. Parallelize fetching: Files and User Data
    const [files, userDoc] = await Promise.all([
      listUserFilesAdmin(userId).catch(e => {
        console.error("Error fetching files:", e)
        return []
      }),
      adminDb.doc(`users/${userId}`).get().catch(e => {
        console.error("Error fetching user:", e)
        return null
      })
    ])

    const dbUserData = userDoc?.data() || {}

    // Merge Contexts: Prioritize Client for Plan/Name (Sync with UI), DB for strict limits if needed
    const finalUserData = {
      ...dbUserData,
      ...(userContext || {})
    }

    // 2. Calculate storage locally 
    const totalBytes = files.reduce((acc, file: any) => acc + (file.size || 0), 0)
    const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2)
    const maxGB = (finalUserData.maxStorage / (1024 * 1024 * 1024)).toFixed(0) || 5

    // 3. Knowledge Base
    const PRICING_KNOWLEDGE = `
      PRICING PLANS:
      1. Free Plan:
         - 5 GB Storage
         - 5 File-to-URL links/month
         - 1 GB Bandwidth
         - Links expire in 2 days
         - No Vault, No AI Chatbot

      2. Starter Plan:
         - 50 GB Storage
         - 50 File-to-URL links/month
         - 10 GB Bandwidth
         - Links expire in 30 days
         - Includes Personal Vault & File-to-URL

      3. Pro Plan:
         - 200 GB Storage
         - 500 File-to-URL links/month
         - 100 GB Bandwidth
         - Links expire in 365 days
         - Includes AI Chatbot, Vault, Priority Support
         - **Includes HD Background Removal**

      4. Enterprise Plan:
         - 1 TB (1024 GB) Storage
         - Unlimited File-to-URL links
         - Unlimited Bandwidth
         - Links never expire
         - Dedicated Account Manager
         - **Unlimited HD Background Removal**
    `

    const FAQ_KNOWLEDGE = `
      FAQ & SUPPORT:
      - Change Password: Go to Settings > Security > Change Password.
      - 2FA (Two-Factor Auth): Enable in Settings > Security > Two-Factor Authentication.
      - Update Profile: Go to Settings > Profile to change your name or avatar.
      - Delete Account: Go to Settings > Danger Zone. (Warn user this is irreversible).
      - Dark Mode: Toggle using the sun/moon icon in the dashboard header.
      - Contact Support: Email support@cloudvault.com or use the form in Settings.
    `

    // 4. Build Context
    const systemPrompt = `You are CloudVault AI, an intelligent storage assistant.
    
    CONTEXT - USER DETAILS:
    - Name: ${finalUserData.displayName || finalUserData.name || 'User'}
    - Email: ${finalUserData.email || 'Unknown'} (Do not share unless asked)
    - Current Plan: ${finalUserData.subscriptionPlan || finalUserData.plan || 'Free'}
    - Plan Expiry: ${finalUserData.planExpiry ? new Date(finalUserData.planExpiry).toLocaleDateString() : 'N/A'}
    - Storage Used: ${totalGB} GB / ${maxGB} GB
    - Total Files: ${files.length}

    CONTEXT - USER FILES (Top 100 recent):
    ${files.slice(0, 100).map((f: any) => `- ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB) [${f.folder || 'Root'}]`).join('\n')}

    ${PRICING_KNOWLEDGE}

    ${FAQ_KNOWLEDGE}

    YOUR CAPABILITIES:
    1. Answer questions about the user's files ("Do I have a file named passport?", "Show me huge files").
    2. Provide account & plan details ("When does my plan expire?", "What's my storage usage?").
    3. Help with app navigation ("How do I change my password?").
    4. Explain pricing tiers if asked.

    GUIDELINES:
    - Be concise and friendly.
    - If a user asks for a file, check the file list above. If found, confirm its existence and folder.
    - If asked about features not in their plan, gently suggest upgrading (e.g. "That's a Pro feature").
    - Respond quickly.
    `

    const result = await streamText({
      model: google('gemini-2.0-flash'),
      system: systemPrompt,
      messages,
    })

    return result.toUIMessageStreamResponse()
  } catch (error: any) {
    console.error('Chat API error:', error?.message || error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
