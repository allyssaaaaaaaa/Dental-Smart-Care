# Build plan: paste ONE prompt at a time into Cursor chat (Agent mode)
Check the result in your browser after each step before sending the next. Rules in .cursor/rules are applied automatically, so prompts stay short (this saves your free usage).

## Step 1: Shell + landing
Set up the theme tokens, fonts, role-based routing, demo login, and the sidebar layouts for all four roles (see designs). Then build the Landing page from @designs/01-landing-part1.png @designs/01-landing-part2.png @designs/01-landing-part3.png (they are one tall page split in 3 parts, top to bottom).

## Step 2: Patient booking (4 steps)
Build the 4-step Book Appointment flow from @designs/02-book-step1.png @designs/03-book-step2.png @designs/04-book-step3.png @designs/05-book-step4.png. Working service selection, dentist selection, calendar and time slots (booked slots disabled), slot-hold countdown, patient form with validation, review step with "Change" links, and a confirmation with a reference code.

## Step 3: Patient pages
Build My Appointments from @designs/06-my-appointments.png (tabs, reschedule, cancel, history table with search/year/pagination) and Live Queue Status from @designs/07-live-queue-status.png (token, position, estimated wait, timeline, roster, updates every few seconds).

## Step 4: Clerk
Build Clerk Dashboard from @designs/08-clerk-dashboard.png, Live Queue Management from @designs/09-clerk-live-queue.png (Call Next, Mark Finishing, Assign Next Patient, Mark Room as Cleaned), and Patient Intake from @designs/10-clerk-patient-intake.png (validation, auto age, creates patient + queue token). Queue state must be shared with the patient Live Queue Status page.

## Step 5: Dentist
Build Dentist Dashboard from @designs/11-dentist-dashboard.png with an availability toggle (Available / On Break / Off Duty) in the top bar.

## Step 6: Admin
Build Admin Analytics from @designs/12-admin-analytics.png (replace autoclave, bur inventory, and financial ledger panels with no-show analytics and appointments-by-service charts; Export Daily Ledger as CSV), Live Queue & Triage from @designs/13-admin-triage.png, and Dentist Directory from @designs/14-admin-dentist-directory.png (remove NPI/credentialing columns). Add a simple Operatory Schedule page.

## Step 7: Display Board
Build a full-screen public Display Board (big "Now Serving" token, next 3 in line, per-room dentist status, waiting count, auto-refresh) in the same visual style.

## Fix prompt (use after any step if something looks off)
Compare the page in the browser to @designs/<file>.png and fix the spacing, colors, and typography to match exactly.
