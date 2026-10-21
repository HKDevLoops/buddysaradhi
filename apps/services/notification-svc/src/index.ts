import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => "notification-svc is running!")
  .listen(process.env.PORT || Math.floor(Math.random() * (4000 - 3000 + 1) + 3000));

console.log(
  `🦊 notification-svc is running at ${app.server?.hostname}:${app.server?.port}`
);
