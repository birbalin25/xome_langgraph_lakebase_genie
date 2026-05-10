import { Bath, BedDouble, Check, Maximize, Star } from "lucide-react";
import type { Property } from "../../types";
import { formatDate, formatPrice } from "../../lib/utils";

interface PropertyCardProps {
  property: Property;
  selected?: boolean;
  onToggle?: (propertyId: string) => void;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500 text-white",
  pending: "bg-yellow-500 text-white",
  auction: "bg-red-500 text-white animate-pulse",
};

export default function PropertyCard({ property: p, selected, onToggle }: PropertyCardProps) {
  const status = (p.listing_status || "active").toLowerCase();
  const statusClass = STATUS_STYLES[status] || STATUS_STYLES.active;
  const score = parseFloat(p.recommendation_score || "0");
  const scorePercent = Math.min(score * 10, 100);
  const imageUrl =
    p.image_url || `https://picsum.photos/seed/${p.property_id}/600/400`;

  return (
    <div
      onClick={() => onToggle?.(p.property_id)}
      className={`group cursor-pointer overflow-hidden rounded-xl border-2 bg-white shadow-sm transition hover:shadow-md ${
        selected ? "border-xome-500 ring-2 ring-xome-200" : "border-gray-200"
      }`}
    >
      {/* Image */}
      <div className="relative h-48 overflow-hidden bg-gray-100">
        {/* Selection tick */}
        {selected && (
          <div className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-xome-600 shadow">
            <Check className="h-4 w-4 text-white" strokeWidth={3} />
          </div>
        )}
        <img
          src={imageUrl}
          alt={p.address}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        {/* Status badge */}
        <span
          className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold uppercase shadow ${statusClass}`}
        >
          {status}
        </span>
        {/* Price overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8">
          <span className="text-xl font-bold text-white">
            {formatPrice(p.price)}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="p-4">
        {/* Beds / Baths / Sqft */}
        <div className="mb-2 flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <BedDouble className="h-4 w-4" />
            {p.beds} bd
          </span>
          <span className="flex items-center gap-1">
            <Bath className="h-4 w-4" />
            {p.baths} ba
          </span>
          <span className="flex items-center gap-1">
            <Maximize className="h-4 w-4" />
            {parseInt(p.sqft || "0").toLocaleString()} sqft
          </span>
        </div>

        {/* Address */}
        <h4 className="truncate text-sm font-semibold text-gray-900">
          {p.address}
        </h4>
        <p className="truncate text-xs text-gray-500">
          {p.neighborhood} &middot; {p.city}, {p.state} {p.zip_code}
        </p>

        {/* Recommendation score bar */}
        {p.recommendation_score && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-gray-500">Match Score</span>
              <span className="font-semibold text-xome-700">
                {score.toFixed(1)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-xome-500 transition-all"
                style={{ width: `${scorePercent}%` }}
              />
            </div>
          </div>
        )}

        {/* School rating */}
        {p.school_rating && (
          <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
            <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
            School Rating: {p.school_rating}/10
          </div>
        )}

        {/* Auction banner */}
        {status === "auction" && (
          <div className="mt-3 rounded-md bg-red-50 p-2 text-xs">
            <p className="font-semibold text-red-700">
              Auction: {formatDate(p.auction_date)}
            </p>
            <p className="text-red-600">
              Starting at {formatPrice(p.auction_start_price || "0")}
            </p>
          </div>
        )}

        {/* Campaign sent banner */}
        {p.campaign_sent_date && (
          <div className="mt-3 rounded-md bg-blue-50 p-2 text-xs">
            <p className="font-semibold text-blue-700">
              Campaign sent on {formatDate(p.campaign_sent_date)}
            </p>
          </div>
        )}

        {/* Email saved banner */}
        {p.campaign_saved_date && !p.campaign_sent_date && (
          <div className="mt-3 rounded-md bg-amber-50 p-2 text-xs">
            <p className="font-semibold text-amber-700">
              Email saved on {formatDate(p.campaign_saved_date)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
