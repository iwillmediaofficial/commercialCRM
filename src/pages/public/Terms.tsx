// NOTE: This is a starting template. Have it reviewed by a lawyer before relying on it.
// Names, contacts, trial and grace days come from public_site_info(), so keep
// the wording in line with how billing actually works in the app.
import { Link } from "react-router";
import { date } from "../../lib/format";
import { productName, useSiteInfo } from "../../lib/site";
import { LegalPage, PublicShell } from "./PublicShell";

export default function Terms() {
  const info = useSiteInfo();
  const product = productName(info);
  const seller = info?.seller_name || `the provider of ${product}`;
  const Seller = info?.seller_name || "We";
  const email = info?.support_email;
  const phone = info?.support_phone;
  const trial = info?.trial_days;
  const grace = info?.grace_days;

  return (
    <PublicShell info={info}>
      <LegalPage title="Terms of Service" updated={date(info?.legal_updated_on)}>
        <p>
          These terms apply to your use of {product} (the "Service"), provided by {seller}
          {info?.seller_address ? `, ${info.seller_address}` : ""} ("we", "us"). By creating an account or using the
          Service, you agree to these terms on behalf of your business (the "Customer", "you").
        </p>

        <h2>1. Who can use the Service</h2>
        <ul>
          <li>The Service is meant for businesses, such as agencies and service companies. It is not meant for personal or household use.</li>
          <li>Company accounts are created by us. After we create your company, we give you a one-time PIN to sign up.</li>
          <li>You can add your own staff. You are responsible for everyone you give access to and for what they do in your account.</li>
          <li>Keep your login details safe and tell us straight away if you think someone has misused your account.</li>
        </ul>

        <h2>2. Free trial</h2>
        <p>
          New companies may get a free trial{trial ? ` of ${trial} days` : ""}. The trial is for trying the Service and may
          have the same limits as a paid plan. At the end of the trial, the account follows the same steps as an expired
          plan (see section 4) unless you buy a plan.
        </p>

        <h2>3. Plans, prices and payment</h2>
        <ul>
          <li>Plans are prepaid for a fixed period (for example one month, three months, six months or one year). Prices and limits are as shown on our website or agreed with you in writing.</li>
          <li>You pay us directly by bank transfer, UPI, cash or cheque. We do not use a payment gateway and we never collect or store card details.</li>
          <li>We confirm each payment by hand. Your plan is extended once we have received and approved the payment.</li>
          <li>Plans do not renew automatically. To continue, you need to pay for the next period before your plan or grace period ends.</li>
          <li>Prices may change. A change applies from your next renewal, not to a period you have already paid for.</li>
          <li>Where GST applies, it is charged as shown on our invoice.</li>
          <li>Fees are non-refundable, except where the law requires a refund.</li>
        </ul>

        <h2>4. When a plan ends</h2>
        <ul>
          <li>
            After your plan or trial ends, you get a grace period{grace ? ` of ${grace} days` : ""} in which the Service keeps working
            normally, so you have time to renew.
          </li>
          <li>
            After the grace period, your account becomes read-only. You can still sign in and see your data, but you cannot add
            or change it. Your public lead forms keep working so you do not lose new enquiries.
          </li>
          <li>Your data is kept while the account is read-only. Full access comes back as soon as your renewal is approved.</li>
        </ul>

        <h2>5. Suspension and termination</h2>
        <p>We may suspend or close an account, with notice where reasonable, if:</p>
        <ul>
          <li>fees are not paid;</li>
          <li>the account is used for anything illegal, for spam, or to harm us, other customers or anyone else;</li>
          <li>you seriously break these terms; or</li>
          <li>we are required to by law or by an authority.</li>
        </ul>
        <p>
          You may stop using the Service at any time. If you want a copy of your data or want it deleted, contact us (see
          section 11).
        </p>

        <h2>6. Your data</h2>
        <ul>
          <li>You own the data you put into the Service, including details of your clients and leads.</li>
          <li>
            For personal data of your clients, leads and staff, you decide why and how it is used, so you are the data
            fiduciary under the Digital Personal Data Protection Act, 2023. We process that data only on your behalf to run
            the Service, as a data processor.
          </li>
          <li>
            You are responsible for having a lawful basis (such as consent) for the personal data you collect, including
            through public lead forms.
          </li>
          <li>
            Our <Link to="/privacy">Privacy Policy</Link> explains how we handle data, where it is stored and how to ask for an
            export or deletion.
          </li>
        </ul>

        <h2>7. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>use the Service to send spam or to store content that is illegal, misleading or infringes anyone's rights;</li>
          <li>try to access other customers' data or parts of the Service you are not allowed to use;</li>
          <li>disrupt, overload, copy, resell or reverse engineer the Service; or</li>
          <li>share your account with people outside your business.</li>
        </ul>

        <h2>8. Availability and support</h2>
        <p>
          We take reasonable care to keep the Service running and your data safe, but we do not promise that it will always
          be available or error-free, and we do not offer a service level agreement (SLA). We may need to stop the Service
          for maintenance or updates, and we may change or improve features over time. Support is available through the
          contact details below.
        </p>

        <h2>9. Limitation of liability</h2>
        <ul>
          <li>The Service is provided "as is". To the extent the law allows, we give no other promises or warranties.</li>
          <li>We are not liable for indirect or consequential losses, such as lost profit, lost business or lost data.</li>
          <li>
            Our total liability for any claim relating to the Service is limited to the fees you paid us in the three (3)
            months before the event that led to the claim.
          </li>
          <li>Nothing in these terms limits liability that cannot be limited under Indian law.</li>
        </ul>

        <h2>10. Governing law</h2>
        <p>
          These terms are governed by the laws of India, including the Information Technology Act, 2000 and the Digital
          Personal Data Protection Act, 2023. Courts in India will have jurisdiction over any dispute. We
          may update these terms; the date at the top shows the latest version, and continuing to use the Service means you
          accept the update.
        </p>

        <h2>11. Contact and grievance officer</h2>
        <p>
          For questions, complaints or grievances about the Service, contact our grievance officer for {seller}:
        </p>
        <ul>
          {email && <li>Email: <a href={`mailto:${email}`}>{email}</a></li>}
          {phone && <li>Phone: <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></li>}
          {info?.seller_address && <li>Address: {info.seller_address}</li>}
        </ul>
        <p>{Seller} will acknowledge grievances and try to resolve them within the time required by law.</p>
      </LegalPage>
    </PublicShell>
  );
}
