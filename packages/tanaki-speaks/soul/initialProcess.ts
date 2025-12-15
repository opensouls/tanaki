
import { MentalProcess, useActions, indentNicely } from "@opensouls/engine";
import externalDialog from "./cognitiveSteps/externalDialog.ts";

const initialProcess: MentalProcess = async ({ workingMemory }) => {
  const { speak  } = useActions()

  const [withDialog, stream] = await externalDialog(
    workingMemory,
    indentNicely`
      Keep the conversation moving, keep the guest delighted and engaged. If the conversation is becoming repeitive or you predict it will end soon, ask a question that will keep the guest engaged: Health, Hobbies, Food, Travel, etc.
    `,
    { stream: true, model: "gpt-5.2" }
  );
  speak(stream);

  return withDialog;
}

export default initialProcess
