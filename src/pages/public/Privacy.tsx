// NOTE: This is a starting template. Have it reviewed by a lawyer before relying on it.
// Keep it in line with what the app really does: storage locations, error
// reports, PIN-based resets and the lack of emails or ad trackers.
import { Link } from "react-router";
import { date } from "../../lib/format";
import { productName, useSiteInfo } from "../../lib/site";
import { LegalPage, PublicShell } from "./PublicShell";

export default function Privacy() {
  const info = useSiteInfo();
  const product = productName(info);
  const seller = info?.seller_name || `the provider of ${product}`;
  const email = info?.support_email;
  const phone = info?.support_phone;

  return (
    <PublicShell info={info}>
      <LegalPage title="Privacy Policy" updated={date(info?.legal_updated_on)}>
        <p>
          This policy explains how {seller}
          {info?.seller_address ? `, ${info.seller_address}` : ""} ("we", "us") handles personal data in {product} (the
          "Service"). It should be read with our <Link to="/terms">Terms of Service</Link>.
        </p>

        <h2>1. Our role</h2>
        <ul>
          <li>
            <strong>Customer data.</strong> Each business that uses the Service (a "customer company") stores details of its
            own clients, leads and staff. The customer company decides why and how that data is used, so it is the data
            fiduciary under the Digital Personal Data Protection Act, 2023. We act as its data processor and handle that
            data only to run the Service for it.
          </li>
          <li>
            <strong>Account data.</strong> For the details of the people who sign in, and of the customer companies we bill,
            we decide how the data is used, and this policy applies to us directly.
          </li>
        </ul>
        <p>
          If you are a client or lead of one of our customers and have a question about your data, please contact that
          business first. We will help them answer your request.
        </p>

        <h2>2. What we collect</h2>
        <ul>
          <li><strong>Account details:</strong> name, email address, password (stored only in hashed form) and role in the company.</li>
          <li><strong>Company and billing details:</strong> company name, address, GSTIN, plan, and records of payments you make to us.</li>
          <li><strong>Content you add:</strong> leads, clients, tasks, time entries, invoices, ad fund records, files and notes.</li>
          <li><strong>Lead form entries:</strong> what visitors type into a customer's public lead form.</li>
          <li>
            <strong>Error reports:</strong> when something breaks, we record the error message, the page it happened on and
            basic browser details, so we can find and fix the bug.
          </li>
        </ul>
        <p>
          We do not collect card or bank account details. Payments are made directly to us by bank transfer, UPI, cash or
          cheque and are recorded by hand.
        </p>

        <h2>3. How we use it</h2>
        <ul>
          <li>to provide the Service, keep each company's data separate, and let the right people sign in;</li>
          <li>to manage plans, payments and renewals;</li>
          <li>to fix bugs, keep the Service secure and prevent misuse; and</li>
          <li>to meet legal duties, such as tax records.</li>
        </ul>
        <p>
          We do not sell personal data and do not use it for advertising. The Service does not send emails or marketing
          messages. Password set-up and resets are done with one-time PINs that an admin gives you, not by email links.
        </p>

        <h2>4. Where data is stored</h2>
        <ul>
          <li>Database and sign-in: Supabase, on servers in Mumbai, India.</li>
          <li>Uploaded files: Cloudflare R2 object storage.</li>
        </ul>
        <p>
          These providers process data on our behalf under their own security and privacy terms. Data is sent over encrypted
          connections (HTTPS), and access inside the Service is limited by company and by role.
        </p>

        <h2>5. Cookies and local storage</h2>
        <p>
          We use your browser's storage only to keep you signed in and to remember your preferences, such as the company you
          last opened. We do not use advertising or tracking cookies, and we do not use third-party analytics that follow you
          across websites.
        </p>

        <h2>6. How long we keep data</h2>
        <ul>
          <li>Customer data is kept while the company account exists, including while it is read-only after a plan ends.</li>
          <li>When a customer asks us to delete their account, we delete their data within a reasonable time, except records we must keep by law (such as billing and tax records).</li>
          <li>Error reports are kept only as long as they are useful for fixing problems.</li>
        </ul>

        <h2>7. Your rights</h2>
        <p>
          Under the Digital Personal Data Protection Act, 2023 you can ask to access, correct or erase your personal data,
          nominate someone to act for you, and raise a grievance. Customer companies can also ask us for an export of their
          data or for it to be deleted. Send requests to the contact below. We may need to confirm who you are before acting
          on a request.
        </p>

        <h2>8. Security</h2>
        <p>
          We take reasonable security measures, as expected under the Information Technology Act, 2000 and related rules.
          No system is completely secure, so please use a strong password and keep your PINs private. If we learn of a breach
          that affects personal data, we will inform affected customers and the authorities as the law requires.
        </p>

        <h2>9. Children</h2>
        <p>The Service is for businesses and is not meant for anyone under 18.</p>

        <h2>10. Changes</h2>
        <p>
          We may update this policy. The date at the top shows the latest version. For important changes we will let customer companies
          know.
        </p>

        <h2>11. Contact and grievance officer</h2>
        <p>For privacy requests or grievances, contact the grievance officer for {seller}:</p>
        <ul>
          {email && <li>Email: <a href={`mailto:${email}`}>{email}</a></li>}
          {phone && <li>Phone: <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></li>}
          {info?.seller_address && <li>Address: {info.seller_address}</li>}
        </ul>
        <p>
          If you are not satisfied with our response, you may complain to the Data Protection Board of India.
        </p>
      </LegalPage>
    </PublicShell>
  );
}
