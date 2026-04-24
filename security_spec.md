# Security Specification - Xavian Care AI

## 1. Data Invariants
- A **Care Log** MUST belong to a valid Family and specify a Parent UID who is a member of that family.
- A **Care Log** cannot be modified or deleted by anyone other than family members.
- **Family Membership** is strictly controlled via the `parents` array in the Family document.
- Users can only read/write their own **User Profile**.
- **Daily Checklists** and **Growth Metrics** can only be updated by family members.

## 2. The Dirty Dozen Payloads (Targeting Vulnerabilities)

1. **Identity Spoofing**: Attempt to create a log with `parentId` set to another user.
2. **Orphaned Log**: Attempt to create a log for a family ID that doesn't exist or that I'm not a member of.
3. **Shadow Field Injection**: Attempt to update a user profile with `admin: true` or `isVerified: true`.
4. **State Shortcutting**: Attempt to update a log's critical fields (like `type` or `familyId`) after creation.
5. **Denial of Wallet**: Attempt to inject 1MB of junk data into a `note` or `medicationName` field.
6. **ID Poisoning**: Attempt to use a 1.5KB string as a `familyId` path variable.
7. **PII Leak**: Attempt to read the private `users` collection without being the owner.
8. **Relational Break**: Attempt to "join" a family by injecting myself into the `parents` array without the document owner's consent (if we had an owner field).
9. **Timestamp Spoofing**: Attempt to set a `createdAt` timestamp to a future date from the client.
10. **Checklist Hijack**: Attempt to toggle another family's checklist.
11. **Growth Manipulation**: Attempt to set Xavian's weight to a negative number or a 1MB string.
12. **Unauthorized Archive Read**: Attempt to list logs for a family I was just removed from.

## 3. Test Runner
*(See firestore.rules.test.ts for implementation)*
