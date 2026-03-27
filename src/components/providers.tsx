"use client";

import {
  ClerkProvider,
  useAuth,
} from "@clerk/nextjs";
import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  ConvexReactClient,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { UnauthenticatedView } from "@/features/auth/components/unauthenticated-view";
import { ThemeProvider } from "./theme-provider";
import { AuthLoadingView } from "@/features/auth/components/auth-loading-view";
import { AiSettingsProvider } from "@/features/ai/provider/ai-settings-provider";
import { CompanionProvider } from "@/features/companion/provider/companion-provider";


const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (  
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Authenticated>
            <CompanionProvider>
              <AiSettingsProvider>{children}</AiSettingsProvider>
            </CompanionProvider>
          </Authenticated>
          <Unauthenticated>
            <UnauthenticatedView />
          </Unauthenticated>
          <AuthLoading>
            <AuthLoadingView />
          </AuthLoading>
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
};
