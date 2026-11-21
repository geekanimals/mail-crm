"use client";

// Who is logged in (name + role), shared by the Insights pages
import { createContext, useContext } from "react";

const SessionContext = createContext({ user: "", role: "" });

export const SessionProvider = SessionContext.Provider;
export const useSession = () => useContext(SessionContext);
