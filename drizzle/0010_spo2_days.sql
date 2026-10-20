CREATE TABLE "spo2_days" (
	"user_id" integer NOT NULL,
	"bucket" integer NOT NULL,
	"offsets" integer[] NOT NULL,
	"values" double precision[] NOT NULL,
	CONSTRAINT "spo2_days_user_id_bucket_pk" PRIMARY KEY("user_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "spo2_days" ADD CONSTRAINT "spo2_days_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;