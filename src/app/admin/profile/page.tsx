import {
  ChangePasswordCard,
  DeleteAccountCard,
  ProfileDetailsCard,
} from "@/components/profile-sections";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminProfilePage() {
  const session = await requireAdmin();

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <ProfileDetailsCard profile={session.profile} />
      <ChangePasswordCard />
      <DeleteAccountCard />
    </div>
  );
}
