"use client";

import { useParams } from "next/navigation";
import NewChatScreen from "@/components/chat/NewChatScreen";

export default function NewChatPage() {
  const params = useParams<{ id: string }>();
  const notebookId = Number(params.id);

  if (!Number.isInteger(notebookId)) {
    return null;
  }

  return <NewChatScreen notebookId={notebookId} />;
}
