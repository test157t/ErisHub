export const supportedActionTypes = [
  "agent.ask", "calculate", "memory.create", "task.create", "task.update", "task.execute", "note.create", "note.append",
  "schedule.create", "notification.create", "web.search", "image.generate", "video.generate", "image.inline", "video.inline", "file.search", "file.get",
  "project.file.search", "project.file.read",
  "hypno.session.configure", "hypno.session.start", "hypno.session.stage", "hypno.session.update", "hypno.session.progress",
  "hypno.session.checkpoint", "hypno.session.pause", "hypno.session.resume", "hypno.session.end", "hypno.spiral.select",
  "hypno.whispers.set", "hypno.whisper.add", "hypno.particles.set", "contact.create", "contact.update", "calendar.create",
  "calendar.update", "profile.update", "project.create", "project.update",
  "assistant-file.create", "assistant-file.update", "assistant-file.delete", "assistant-file.hashline", "python.run",
  "audio.play", "intiface.play", "intiface.stop", "hypno.choices", "thoughts", "discord.send"
] as const;

export const supportedActionTypeSet = new Set<string>(supportedActionTypes);
export const automationActionTypes = new Set<string>(["agent.ask", "task.create", "task.update", "task.execute", "note.create", "note.append", "schedule.create", "notification.create", "memory.create", "contact.create", "contact.update", "calendar.create", "calendar.update", "profile.update", "project.create", "project.update", "assistant-file.create", "assistant-file.update", "assistant-file.delete", "assistant-file.hashline", "python.run", "audio.play", "intiface.play", "intiface.stop", "discord.send"]);
export const externalActionTypes = new Set<string>(["web.search", "image.generate", "video.generate"]);
export const fileActionTypes = new Set<string>(["file.search", "file.get", "project.file.search", "project.file.read"]);
