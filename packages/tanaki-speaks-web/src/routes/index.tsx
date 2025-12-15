import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: TanakiRoute });

function TanakiRoute() {
  return <p>hello</p>
 
}
