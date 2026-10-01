import { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { isClerkAPIResponseError, useClerk, useSignIn, useSSO } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import * as AppleAuthentication from "expo-apple-authentication";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { providerOutcome, RV_LIGHT_ISLAND } from "@rv-trip/core";
import { C, F, R } from "../src/theme";
import { Button, Kicker } from "../src/ui";

/**
 * Sign-in — email code, Apple (iOS), Google (issues #44 item 2, #123).
 *
 * One screen, two steps. The first step stacks the one-tap providers above an
 * "or" divider: Continue with Apple (the native iOS button, only where
 * `isAvailableAsync()` says Sign in with Apple exists — never on Android), then
 * Continue with Google (Clerk's `useSSO`, `oauth_google`). Below the divider,
 * unchanged: email → 6-digit code, Clerk's email-code first factor, the only
 * one that needs no dashboard configuration. Rendered by `app/_layout.tsx`
 * inside `<Show when="signed-out">`, so while there is no session this is the
 * whole app — the navigator is not mounted at all.
 *
 * It is also a route file (`/sign-in`), which is why it default-exports a plain
 * screen component and never navigates: `signIn.finalize()` flips
 * `<Show when="signed-out">` to `<Show when="signed-in">` and the Stack mounts
 * itself.
 *
 * #147 (Q1 B): core-3's signal API. `signIn.emailCode.sendCode` / `verifyCode`
 * and `signIn.finalize` resolve `{ error }` rather than throwing, so each
 * returned error goes through the same `messageFor` precedence a thrown one
 * does.
 */

/** Seconds before "Resend" becomes tappable. The wireframe draws this mid-count
 * ("Resend in 24s"); 30 is the start, so 24 is six seconds in. */
const RESEND_SECONDS = 30;

/** Google's official "G" mark (branding guidelines), drawn at 16×16. */
const GOOGLE_G = require("../assets/google-g.png");

/** The one failure string we author. Clerk's own message wins when it has one. */
const GENERIC_ERROR = "Something went wrong — check your connection and try again.";

/** Which slot an error renders in: under the provider stack, or inside the form. */
type ErrorFrom = "provider" | "email";

/** Clerk's own message wins; anything else — a network throw — is GENERIC_ERROR. */
function messageFor(e: unknown): string {
  if (isClerkAPIResponseError(e)) {
    const first = e.errors[0];
    return first?.longMessage ?? first?.message ?? GENERIC_ERROR;
  }
  return GENERIC_ERROR;
}

// Closes the Google auth tab when the redirect lands back in the app.
WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const clerk = useClerk();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startSSOFlow } = useSSO();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [errorFrom, setErrorFrom] = useState<ErrorFrom>("email");
  /** The provider flow in flight — only Google relabels (Apple's label is iOS's). */
  const [via, setVia] = useState<"apple" | "google" | null>(null);
  /** One busy flag for all three controls: an email-code request or a provider. */
  const busy = fetchStatus === "fetching" || via !== null;
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const codeField = useRef<TextInput>(null);

  // The resend countdown, ticking only while the code step is up.
  useEffect(() => {
    if (step !== "code" || seconds === 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, seconds]);

  // Sign in with Apple exists only on iOS, and not on every iOS device — ask
  // once and hold the answer, so the button never renders where it can't work.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let live = true;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => live && setAppleAvailable(ok))
      .catch(() => live && setAppleAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  function failed(e: unknown, from: ErrorFrom = "email") {
    setErrorFrom(from);
    setError(messageFor(e));
  }

  /**
   * Shared by both providers. Clerk hands back `createdSessionId: null` both
   * when she backs out (no error — backing out isn't a failure) and when the
   * exchange ran but ended without a session; `providerOutcome` tells them apart
   * by whether a sign-in / sign-up was actually started (its id changed).
   *
   * The provider hooks run on Clerk's classic resources (`clerk.client`'s
   * signIn / signUp, mutated in place and handed back on the result), not on
   * the signal `signIn` the email step uses — so the before-ids are read from
   * `clerk.client` and compared against the resources the hook returns.
   */
  async function runProvider(
    which: "apple" | "google",
    start: () => Promise<{
      createdSessionId: string | null;
      browserResultType?: string | null;
      signIn?: { id?: string | null } | null;
      signUp?: { id?: string | null } | null;
    }>,
  ) {
    if (busy) return;
    setVia(which);
    setError("");
    const before = {
      signIn: clerk.client?.signIn?.id ?? null,
      signUp: clerk.client?.signUp?.id ?? null,
    };
    try {
      const res = await start();
      const outcome = providerOutcome({
        createdSessionId: res.createdSessionId,
        attempted:
          (res.signIn?.id ?? null) !== before.signIn || (res.signUp?.id ?? null) !== before.signUp,
        browserResultType: res.browserResultType,
      });
      if (outcome === "session") {
        await clerk.setActive({ session: res.createdSessionId });
        return; // <Show when="signed-in"> takes over; this screen unmounts.
      }
      if (outcome === "incomplete") {
        setErrorFrom("provider");
        setError(GENERIC_ERROR);
      }
    } catch (e) {
      failed(e, "provider");
    } finally {
      setVia(null);
    }
  }

  function continueWithApple() {
    void runProvider("apple", () => startAppleAuthenticationFlow());
  }

  function continueWithGoogle() {
    void runProvider("google", async () => {
      const res = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri({ scheme: "tripcaddie" }),
      });
      return {
        createdSessionId: res.createdSessionId,
        browserResultType: res.authSessionResult?.type ?? null,
        signIn: res.signIn,
        signUp: res.signUp,
      };
    });
  }

  async function sendCode() {
    if (busy) return;
    setError("");
    try {
      const { error } = await signIn.emailCode.sendCode({ emailAddress: email.trim() });
      if (error) return failed(error);
      setCode("");
      setSeconds(RESEND_SECONDS);
      setStep("code");
    } catch (e) {
      failed(e);
    }
  }

  async function verify(entered: string) {
    if (busy) return;
    setError("");
    try {
      const { error } = await signIn.emailCode.verifyCode({ code: entered });
      if (error) {
        failed(error);
        setCode("");
        return;
      }
      if (signIn.status === "complete") {
        // finalize resolves { error } too — a failure here must not leave the
        // person on step 2 with no message (#147 vet finding 3).
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) failed(finalizeError);
        return; // <Show when="signed-in"> takes over; this screen unmounts.
      }
      setErrorFrom("email");
      setError(GENERIC_ERROR);
    } catch (e) {
      failed(e);
      setCode("");
    }
  }

  function onCodeChange(next: string) {
    const digits = next.replace(/[^0-9]/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {step === "email" ? (
          <View style={styles.body}>
            <Kicker color={C.accent}>Sign in</Kicker>
            <Text style={styles.h1}>RV Trip Hub</Text>
            <Text style={styles.lede}>
              Plan on the laptop, glance on the phone. Use the same account you use on the web.
            </Text>
            <View style={styles.providers}>
              {Platform.OS === "ios" && appleAvailable ? (
                <View style={busy && styles.dim} pointerEvents={busy ? "none" : "auto"}>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                    cornerRadius={R.md}
                    style={{ height: 40, width: "100%" }}
                    onPress={continueWithApple}
                  />
                </View>
              ) : null}
              <Pressable
                onPress={continueWithGoogle}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                style={[styles.google, busy && styles.dim]}
              >
                <Image source={GOOGLE_G} style={styles.googleMark} resizeMode="contain" />
                <Text style={styles.googleText}>
                  {via === "google" ? "Opening Google…" : "Continue with Google"}
                </Text>
              </Pressable>
            </View>
            {error && errorFrom === "provider" ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.or}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>or</Text>
              <View style={styles.orLine} />
            </View>
            <View style={styles.form}>
              <Kicker>Email</Kicker>
              <TextInput
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={sendCode}
                placeholder="you@example.com"
                placeholderTextColor={C.inkSubtle}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="go"
                style={styles.field}
              />
              {error && errorFrom === "email" ? <Text style={styles.error}>{error}</Text> : null}
              <Button onPress={sendCode} disabled={busy || !email.includes("@")}>
                Continue
              </Button>
              <Text style={styles.mono}>We'll email you a 6-digit code.</Text>
            </View>
          </View>
        ) : (
          <View style={styles.body}>
            <Kicker color={C.accent}>Sign in · step 2</Kicker>
            <Text style={[styles.h1, { fontSize: 22 }]}>Check your email</Text>
            <Text style={styles.lede}>
              We sent a 6-digit code to <Text style={styles.inlineMono}>{email.trim()}</Text>.
            </Text>
            <Pressable style={styles.codeRow} onPress={() => codeField.current?.focus()}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={styles.codeCell}>
                  <Text style={styles.codeDigit}>{code[i] ?? "·"}</Text>
                </View>
              ))}
              <TextInput
                ref={codeField}
                value={code}
                onChangeText={onCodeChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                style={styles.codeInput}
              />
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              onPress={() => {
                void signIn.reset();
                setStep("email");
                setCode("");
                setError("");
              }}
              accessibilityRole="button"
              style={styles.ghost}
            >
              <Text style={styles.ghostText}>Use a different email</Text>
            </Pressable>
            {seconds > 0 ? (
              <Text style={styles.mono}>Didn't arrive? Resend in {seconds}s</Text>
            ) : (
              <Pressable onPress={sendCode} accessibilityRole="button">
                <Text style={[styles.mono, { color: C.accent }]}>Didn't arrive? Resend the code</Text>
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surfaceAlt },
  /** The wireframe's `.ph-body`: 40 below the status bar, 20 in, 22 at the foot. */
  body: { paddingTop: 40, paddingHorizontal: 20, paddingBottom: 22, gap: 14 },
  h1: { color: C.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.7 },
  lede: { color: C.inkMuted, fontSize: 13, lineHeight: 19 },
  inlineMono: { fontFamily: F.mono, fontSize: 12, color: C.ink },
  /** Wireframe §2: the provider stack sits where the form's `marginTop 6` does. */
  providers: { marginTop: 6, gap: 8 },
  /** Busy: the shipped Button's disabled dim. */
  dim: { opacity: 0.5 },
  /** Google's button is a foreign mark — it wears the light-island half (G3). */
  google: {
    height: 40,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: RV_LIGHT_ISLAND.borderHi,
    backgroundColor: RV_LIGHT_ISLAND.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  googleMark: { width: 16, height: 16 },
  googleText: { color: RV_LIGHT_ISLAND.ink, fontSize: 13.5, fontWeight: "600" },
  or: { flexDirection: "row", alignItems: "center", gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: C.border },
  orText: {
    fontFamily: F.mono,
    fontSize: 10,
    color: C.inkFaded,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  form: { marginTop: 6, gap: 7 },
  field: {
    color: C.ink,
    fontSize: 13,
    backgroundColor: C.navyDeep,
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.md,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  codeRow: { marginTop: 6, flexDirection: "row", gap: 6 },
  codeCell: {
    flex: 1,
    height: 42,
    backgroundColor: C.navyDeep,
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.md,
    alignItems: "center",
    justifyContent: "center",
  },
  codeDigit: { fontFamily: F.mono, fontSize: 16, color: C.ink },
  /** One real field behind the six drawn cells — one caret, one paste target,
   * and iOS's one-time-code autofill lands in it. */
  codeInput: { position: "absolute", top: 0, left: 0, right: 0, height: 42, opacity: 0 },
  ghost: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.md,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: "center",
  },
  ghostText: { color: C.ink, fontSize: 12.5, fontWeight: "700" },
  mono: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded, textAlign: "center" },
  error: { color: C.warning, fontSize: 12.5, lineHeight: 17 },
});
