import ky, { HTTPError } from "ky";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import {
  CopyIcon,
  ImagePlusIcon,
  HistoryIcon,
  LoaderIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import { Button } from "@/components/ui/button";

import {
  useConversation,
  useConversations,
  useCreateConversation,
  useMessages,
} from "../hooks/use-conversations";

import { Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CONVERSATION_TITLE } from "../../../../convex/constants";
import {
  ADD_SELECTION_TO_CHAT_EVENT,
  AddSelectionToChatDetail,
} from "../constants";

const MAX_SELECTED_CODE_CHARS = 8_000;
const MAX_IMAGE_ATTACHMENTS = 3;
const MAX_IMAGE_ATTACHMENT_BYTES = 1024 * 1024;

const ConversationAttachmentPreview = ({
  onHasAttachmentsChange,
}: {
  onHasAttachmentsChange: (hasAttachments: boolean) => void;
}) => {
  const attachments = usePromptInputAttachments();

  useEffect(() => {
    onHasAttachmentsChange(attachments.files.length > 0);
  }, [attachments.files.length, onHasAttachmentsChange]);

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments className="mb-2" variant="inline">
      {attachments.files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => attachments.remove(file.id)}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
};

const ConversationPromptTools = ({
  isProcessing,
  onTranscriptionChange,
}: {
  isProcessing: boolean;
  onTranscriptionChange: (text: string) => void;
}) => {
  const attachments = usePromptInputAttachments();

  return (
    <PromptInputTools>
      <PromptInputButton
        aria-label="Attach image"
        onClick={attachments.openFileDialog}
        disabled={isProcessing}
        size="icon-xs"
        variant="highlight"
      >
        <ImagePlusIcon className="size-3.5" />
      </PromptInputButton>
      <SpeechInput
        aria-label="Voice input"
        onTranscriptionChange={onTranscriptionChange}
        disabled={isProcessing}
        size="icon-xs"
        variant="highlight"
      />
    </PromptInputTools>
  );
};

interface ConversationSidebarProps {
  projectId: Id<"projects">;
}

export const ConversationSidebar = ({
  projectId,
}: ConversationSidebarProps) => {
  const [input, setInput] = useState("");
  const [selectedConversationId, setSelectedConversationId] =
    useState<Id<"conversations"> | null>(null);
  const [pastConversationsOpen, setPastConversationsOpen] = useState(false);
  const [hasPendingAttachments, setHasPendingAttachments] = useState(false);

  const createConversation = useCreateConversation();
  const conversations = useConversations(projectId);

  const activeConversationId =
    selectedConversationId ?? conversations?.[0]?._id ?? null;

  const activeConversation = useConversation(activeConversationId);
  const conversationMessages = useMessages(activeConversationId);
  const activeProcessingMessageId = conversationMessages
    ?.slice()
    .reverse()
    .find(
      (message) =>
        message.status === "processing" && message.role === "assistant",
    )?._id;

  // Check if any message is currently processing
  const isProcessing = conversationMessages?.some(
    (msg) => msg.status === "processing",
  );

  useEffect(() => {
    const handleAddSelectionToChat = (event: Event) => {
      const customEvent = event as CustomEvent<AddSelectionToChatDetail>;
      const selectedCode = customEvent.detail?.selectedCode?.trim();
      const fileName = customEvent.detail?.fileName;

      if (!selectedCode) {
        return;
      }

      const clippedCode =
        selectedCode.length > MAX_SELECTED_CODE_CHARS
          ? `${selectedCode.slice(0, MAX_SELECTED_CODE_CHARS)}\n...[truncated]`
          : selectedCode;

      const language = fileName?.split(".").pop()?.toLowerCase() ?? "";
      const snippetLabel = fileName
        ? `Selected code from ${fileName}:`
        : "Selected code:";
      const snippet = `${snippetLabel}\n\`\`\`${language}\n${clippedCode}\n\`\`\``;

      setInput((currentInput) => {
        const trimmed = currentInput.trimEnd();
        return trimmed ? `${trimmed}\n\n${snippet}` : snippet;
      });
    };

    window.addEventListener(
      ADD_SELECTION_TO_CHAT_EVENT,
      handleAddSelectionToChat as EventListener,
    );

    return () => {
      window.removeEventListener(
        ADD_SELECTION_TO_CHAT_EVENT,
        handleAddSelectionToChat as EventListener,
      );
    };
  }, []);

  const handleCancel = useCallback(async () => {
    if (!activeProcessingMessageId) {
      return;
    }

    try {
      await ky.post("/api/messages/cancel", {
        json: { messageId: activeProcessingMessageId },
      });
    } catch (error) {
      // Parse the server response to show a meaningful message.
      if (error instanceof HTTPError) {
        const payload = (await error.response.json().catch(() => null)) as {
          error?: string;
        } | null;
        const serverMessage = payload?.error;

        // 409 means the message already finished -- not really an error.
        if (error.response.status === 409) {
          toast.info(serverMessage ?? "Response already completed");
          return;
        }

        toast.error(serverMessage ?? "Unable to cancel request");
        return;
      }
      toast.error("Unable to cancel request");
    }
  }, [activeProcessingMessageId]);

  const handleCreateConversation = async () => {
    try {
      const newConversationId = await createConversation({
        projectId,
        title: DEFAULT_CONVERSATION_TITLE,
      });
      setSelectedConversationId(newConversationId);
      return newConversationId;
    } catch {
      toast.error("Unable to create new conversation");
      return null;
    }
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = await handleCreateConversation();
      if (!conversationId) {
        return;
      }
    }

    // Trigger Inngest function via API
    try {
      await ky.post("/api/messages", {
        json: {
          conversationId,
          message: message.text,
          attachments: message.files,
        },
      });
    } catch (error) {
      let messageText = "Message failed to send";
      if (error instanceof HTTPError) {
        const payload = (await error.response.json().catch(() => null)) as {
          error?: string;
        } | null;
        messageText = payload?.error ?? messageText;
      }
      toast.error(messageText);
    }

    setInput("");
  };

  const handleVoiceTranscription = (transcribedText: string) => {
    const transcript = transcribedText.trim();
    if (!transcript) {
      return;
    }

    setInput((currentInput) => {
      const trimmedCurrent = currentInput.trimEnd();
      if (!trimmedCurrent) {
        return transcript;
      }

      const separator = trimmedCurrent.endsWith("\n") ? "" : " ";
      return `${trimmedCurrent}${separator}${transcript}`;
    });
  };

  return (
    <>
      <div className="relative flex flex-col h-full bg-sidebar">
        {pastConversationsOpen && (
          <div className="absolute inset-0 z-20 bg-sidebar/95 backdrop-blur-sm p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Past conversations</span>
              <Button
                size="icon-xs"
                variant="highlight"
                onClick={() => setPastConversationsOpen(false)}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1">
              {conversations?.map((conversation) => (
                <button
                  key={conversation._id}
                  onClick={() => {
                    setSelectedConversationId(conversation._id);
                    setPastConversationsOpen(false);
                  }}
                  className="text-left px-2 py-1.5 rounded-sm hover:bg-accent/40 text-sm truncate"
                >
                  {conversation.title}
                </button>
              ))}
              {conversations?.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No previous conversations yet.
                </span>
              )}
            </div>
          </div>
        )}
        <div className="h-8.75 flex items-center justify-between border-b">
          <div className="text-sm truncate pl-3">
            {activeConversation?.title ?? DEFAULT_CONVERSATION_TITLE}
          </div>
          <div className="flex items-center px-1 gap-1">
            <Button
              size="icon-xs"
              variant="highlight"
              onClick={() => setPastConversationsOpen(true)}
            >
              <HistoryIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="highlight"
              onClick={handleCreateConversation}
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <Conversation className="flex-1">
          <ConversationContent>
            {conversationMessages?.map((message, messageIndex) => (
              <Message key={message._id} from={message.role}>
                <MessageContent>
                  {message.status === "processing" ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <LoaderIcon className="size-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  ) : message.status === "cancelled" ? (
                    <span className="text-muted-foreground italic">
                      Request cancelled
                    </span>
                  ) : (
                    <MessageResponse>{message.content}</MessageResponse>
                  )}
                </MessageContent>
                {message.role === "assistant" &&
                  message.status === "completed" &&
                  messageIndex === (conversationMessages?.length ?? 0) - 1 && (
                    <MessageActions>
                      <MessageAction
                        onClick={() => {
                          navigator.clipboard.writeText(message.content);
                        }}
                        label="Copy"
                      >
                        <CopyIcon className="size-3" />
                      </MessageAction>
                    </MessageActions>
                  )}
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="p-3">
          <PromptInput
            onSubmit={handleSubmit}
            className="mt-2"
            accept="image/*"
            maxFiles={MAX_IMAGE_ATTACHMENTS}
            maxFileSize={MAX_IMAGE_ATTACHMENT_BYTES}
            onError={(error) => toast.error(error.message)}
          >
            <PromptInputBody>
              <ConversationAttachmentPreview
                onHasAttachmentsChange={setHasPendingAttachments}
              />
              <PromptInputTextarea
                placeholder="Ask Knox anything..."
                onChange={(e) => setInput(e.target.value)}
                value={input}
                disabled={isProcessing}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <ConversationPromptTools
                isProcessing={Boolean(isProcessing)}
                onTranscriptionChange={handleVoiceTranscription}
              />
              <PromptInputSubmit
                disabled={
                  isProcessing ? false : !input.trim() && !hasPendingAttachments
                }
                status={isProcessing ? "streaming" : undefined}
                onStop={handleCancel}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
};
