
import { MentalProcess, useActions, usePerceptions, useSoulMemory, indentNicely } from "@opensouls/engine";
import externalDialog from "./cognitiveSteps/externalDialog.ts";
import internalMonologue from "./cognitiveSteps/internalMonologue.ts";

const MAX_BATCHED_MESSAGES = 7;

const initialProcess: MentalProcess = async ({ workingMemory }) => {
  const { speak, log } = useActions()
  const { pendingPerceptions, invokingPerception } = usePerceptions()
  
  const batchedMessageCount = useSoulMemory<number>("batchedMessageCount", 0)
  const lastResponseTime = useSoulMemory<number>("lastResponseTime", 0)
  const connectedUsers = useSoulMemory<number>("connectedUsers", 0)

  // Update connected users count from metadata if provided
  if (invokingPerception?._metadata?.connectedUsers !== undefined) {
    connectedUsers.current = invokingPerception._metadata.connectedUsers as number
    log(`Connected users: ${connectedUsers.current}`)
  }

  // Track that we received a message
  batchedMessageCount.current = batchedMessageCount.current + 1
  
  const messageCount = batchedMessageCount.current
  const timeSinceLastResponse = Date.now() - lastResponseTime.current
  const hasPendingPerceptions = pendingPerceptions.current.length > 0
  
  log(`Batched messages: ${messageCount}, pending: ${pendingPerceptions.current.length}, time since last: ${timeSinceLastResponse}ms`)

  // Decide whether to respond now or wait for more messages
  const shouldRespond = 
    // No more messages coming
    !hasPendingPerceptions || (
      // We've accumulated enough messages
      messageCount >= MAX_BATCHED_MESSAGES ||
        // First message and no pending - just respond
      (messageCount === 1 && lastResponseTime.current === 0)
    )

  // If there are pending perceptions and we haven't hit the max, wait for more
  if (!shouldRespond) {
    log(`Waiting for more messages... (${messageCount} batched, ${pendingPerceptions.current.length} pending)`)
    return workingMemory
  }

  // Time to respond - reset counters
  const respondingToCount = messageCount
  batchedMessageCount.current = 0
  lastResponseTime.current = Date.now()

  let contextInstruction: string
  
  if (respondingToCount === 1) {
    contextInstruction = indentNicely`
      Keep the conversation moving, keep the guest delighted and engaged.
      If the conversation is becoming repetitive or you predict it will end soon, ask a question that will keep the guest engaged: Health, Hobbies, Food, Travel, etc.
    `
  } else {
    contextInstruction = indentNicely`
      Multiple messages just came in quickly. Respond to all the points naturally and conversationally.
      Keep the conversation moving, keep the guest delighted and engaged.
    `
  }

  // Add context about connected users if multiple are present
  if (connectedUsers.current > 1) {
    contextInstruction += indentNicely`
      
      Remember: ${connectedUsers.current} people are listening to this conversation.
    `
  }

  const [withDialog, stream] = await externalDialog(
    workingMemory,
    contextInstruction,
    { stream: true, model: "gpt-5-mini" }
  );
  speak(stream);

  const [withThoughts, thoughts] = await internalMonologue(
    withDialog,
    indentNicely`
      Reflect on the conversation${connectedUsers.current > 1 ? ` with ${connectedUsers.current} people connected` : ''}.
      How's it going? What can get them to creative, collaboration and kindness faster?
    `,
    { model: "gpt-5-mini" }
  );

  log(thoughts);

  return withThoughts;
}

export default initialProcess
