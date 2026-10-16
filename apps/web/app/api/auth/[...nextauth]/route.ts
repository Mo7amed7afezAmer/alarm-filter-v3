import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// FR-25: NextAuth credentials sign-in (D-02 allows /api/auth/* besides /api/v1).
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
