"use client";

import { useParams } from "next/navigation";
import ChatScreen from "@/components/chat/ChatScreen";

export default function ChatPage() {
  const params = useParams<{ id: string; chatId: string }>();
  const notebookId = Number(params.id);
  const chatId = Number(params.chatId);

  if (!Number.isInteger(notebookId) || !Number.isInteger(chatId)) {
    return null;
  }

  return <ChatScreen notebookId={notebookId} chatId={chatId} />;
}
