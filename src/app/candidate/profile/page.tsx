import {
  ChangePasswordCard,
  DeleteAccountCard,
  ProfileDetailsCard,
} from "@/components/profile-sections";
import { requireCandidate } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function CandidateProfilePage() {
  const session = await requireCandidate();

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <ProfileDetailsCard profile={session.profile} />
      <ChangePasswordCard />
      <DeleteAccountCard />
    </div>
  );
}
