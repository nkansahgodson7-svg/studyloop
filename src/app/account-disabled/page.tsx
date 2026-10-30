import Link from "next/link";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Icon } from "@/components/ui/icons";

export const metadata = {
  title: "Account disabled"
};

export default function AccountDisabledPage() {
  return (
    <ScreenSection>
      <div className="auth">
        <div className="auth__brand">
          <span className="auth__orb" aria-hidden="true" />
          <p className="eyebrow">Account access</p>
          <h1 className="auth__mark">
            Study<em>Loop</em>
          </h1>
        </div>
        <div className="auth__form stack--16">
          <div className="empty" style={{ borderStyle: "solid", background: "var(--surface)" }}>
            <Icon name="key" size={26} />
            <div role="alert" className="stack--8">
              <p className="h3">This account is disabled</p>
              <p className="small text-pretty">
                An administrator has disabled your account, so you have been signed out.
                If it has been re-enabled, try signing in again. Otherwise, contact your
                workspace admin to request access.
              </p>
            </div>
            <Link className="btn btn--primary btn--sm" href="/login">
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    </ScreenSection>
  );
}
