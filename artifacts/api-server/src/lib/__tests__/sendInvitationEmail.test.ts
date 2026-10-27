import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class { emails = { send: sendMock }; },
}));

const params = {
  to: "cliente@example.com",
  inviterName: "Admin",
  orgName: "Mi Negocio",
  role: "member",
  acceptUrl: "https://example.com/invite/abc",
  expiresAt: new Date("2030-01-01T00:00:00Z"),
};

describe("sendInvitationEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
  });

  it("devuelve ok:false cuando no hay RESEND_API_KEY (sin lanzar)", async () => {
    delete process.env["RESEND_API_KEY"];
    const { sendInvitationEmail } = await import("../email");
    const r = await sendInvitationEmail(params);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/RESEND_API_KEY/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("devuelve ok:false con el mensaje del proveedor cuando Resend rechaza el envío (403)", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    sendMock.mockResolvedValue({ data: null, error: { message: "You can only send testing emails to your own email address", name: "validation_error" } });
    const { sendInvitationEmail } = await import("../email");
    const r = await sendInvitationEmail(params);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("testing emails");
  });

  it("devuelve ok:true con el id cuando el proveedor confirma el envío", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    sendMock.mockResolvedValue({ data: { id: "email_123" }, error: null });
    const { sendInvitationEmail } = await import("../email");
    const r = await sendInvitationEmail(params);
    expect(r).toEqual({ ok: true, id: "email_123" });
  });
});
