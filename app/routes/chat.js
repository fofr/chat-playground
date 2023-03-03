import MarkdownIt from 'markdown-it'
import { ChatGPTAPI } from 'chatgpt'
import { DateTime } from 'luxon'
const md = new MarkdownIt()
const chatAgents = {}

const systemPrompts = {
  govuk: `
Give all responses in markdown format.
Using headings to break down long answers, starting from h3 level (\`###\`).
Write all content in GOV.UK style. Be concise and use active voice.
Limit responses to 2 paragraphs.`,
  prototyper: `
You are an assistant to a GOV.UK interaction designer. You are helping them to create a prototype of a new government service.
You need to assist them in determining user journeys, form fields, and content for the prototype.
Write all content in GOV.UK style. Be concise and use active voice. Do not say please.

Always give examples in the YAML format wrapped in a code block.

YAML for a page must start in the format:
\`\`\`
title: "Page title"
slug: "page-slug"
\`\`\`

When giving examples of input fields, do so in a format like:
\`\`\`
type: "text"
label: "Child's name"
decorate: "child-name"
\`\`\`

For radios and checkboxes, use \`items\` instead of \`options\`.

Always give examples in the YAML format wrapped in a code block.
`
}

const chatAgent = (systemMessage) => {
  return new ChatGPTAPI({
    apiKey: process.env.OPENAI_API_KEY,
    systemMessage
  })
}

const toHtml = (markdown) => {
  return md.render(markdown)
}

const parentMessageId = (chatHistory) => {
  const parentMessage = chatHistory.messages[chatHistory.messages.length - 1]
  return parentMessage ? parentMessage.id : null
}

export default (router) => {
  router.all('/chat/:type/new', (req, res, next) => {
    const chatId = Math.random().toString(36).slice(2, 5).toUpperCase()
    res.redirect(`/chat/${req.params.type}/${chatId}`)
  })

  router.all([
    '/chat/:type/:id',
    '/chat/:type/:id/*'
  ], (req, res, next) => {
    const type = req.params.type
    const chatId = req.params.id
    const chats = req.session.data.chats
    const chatHistory = chats[chatId] || {
      id: chatId,
      messages: [],
      type,
      createdAt: DateTime.now().toISO()
    }

    if (!chats[chatId]) {
      chats[chatId] = chatHistory
    }

    if (!chatAgents[type]) {
      chatAgents[type] = {}
    }

    if (!chatAgents[type][chatId]) {
      chatAgents[type][chatId] = chatAgent(systemPrompts[type] || '')
    }

    res.locals.chatId = chatId
    res.locals.type = type
    res.locals.chatHistory = chatHistory

    next()
  })

  router.get('/chat/:type/:id', (req, res) => {
    res.render('chat')
  })

  router.post('/chat/:type/:id/stream', async (req, res) => {
    const chatAgent = chatAgents[res.locals.type][res.locals.chatId]
    const chatHistory = res.locals.chatHistory
    const chatMessage = {
      request: req.body.message,
      requestHtml: toHtml(req.body.message)
    }

    res.set({
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked'
    })

    const stream = res.writeHead(200, {
      'Content-Type': 'application/json'
    })

    const response = await chatAgent.sendMessage(req.body.message, {
      parentMessageId: parentMessageId(chatHistory),
      onProgress: (partialResponse) => {
        chatMessage.id = partialResponse.id
        chatMessage.message = partialResponse.text
        chatMessage.messageHtml = toHtml(partialResponse.text)
        stream.write(JSON.stringify(chatMessage))
      }
    })

    chatMessage.id = response.id
    chatMessage.message = response.text
    chatMessage.messageHtml = toHtml(response.text)
    chatMessage.response = response
    chatHistory.messages.push(chatMessage)
    stream.end()
  })

  router.post('/chat/:type/:id/endpoint', async (req, res) => {
    const chatAgent = chatAgents[res.locals.type][res.locals.chatId]
    const chatHistory = res.locals.chatHistory

    const response = await chatAgent.sendMessage(req.body.message, {
      parentMessageId: parentMessageId(chatHistory)
    })

    const chatMessage =
      {
        request: req.body.message,
        requestHtml: toHtml(req.body.message),
        id: response.id,
        message: response.text,
        messageHtml: toHtml(response.text),
        response
      }

    chatHistory.messages.push(chatMessage)
    res.json(chatMessage)
  })
}
