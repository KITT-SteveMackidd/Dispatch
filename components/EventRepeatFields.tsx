import { useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { MaterialIcons } from "@expo/vector-icons";
import { KeyboardAwareDrawerTextInput } from "@/components/KeyboardAwareDrawer";
import { buildEventSchedule } from "@/lib/event-schedule";
import {
  describeRepeat,
  expandEventOccurrences,
  WEEKDAYS,
  type RepeatRule,
} from "@/lib/event-recurrence";

function Choice({
  label,
  value,
  options,
  onChange,
  dark,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  dark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const color = dark ? "#F7F7F7" : "#212121";
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(!open);
        }}
        style={[
          styles.input,
          { backgroundColor: dark ? "#152B43" : "#F4F4FC" },
        ]}
      >
        <Text style={[styles.value, { color }]}>
          {options.find((item) => item.value === value)?.label}
        </Text>
        <MaterialIcons
          name={open ? "expand-less" : "expand-more"}
          size={24}
          color="#0EC3C9"
        />
      </Pressable>
      {open ? (
        <View accessibilityRole="radiogroup">
          {options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === option.value }}
              style={styles.option}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <MaterialIcons
                name={
                  value === option.value
                    ? "radio-button-checked"
                    : "radio-button-unchecked"
                }
                size={22}
                color="#0EC3C9"
              />
              <Text style={[styles.value, { color }]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function EventRepeatFields({
  value,
  onChange,
  mode,
  date = "",
  time = "",
  endTime = "",
  isDarkMode = false,
}: {
  value: RepeatRule | null;
  onChange: (rule: RepeatRule | null) => void;
  mode: "event" | "template";
  date?: string;
  time?: string;
  endTime?: string;
  isDarkMode?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const [datePicker, setDatePicker] = useState(false);
  const color = isDarkMode ? "#F7F7F7" : "#212121";
  const inputStyle = [
    styles.input,
    { color, backgroundColor: isDarkMode ? "#152B43" : "#F4F4FC" },
  ];
  const preset = !value
    ? "none"
    : value.frequency === "weekly" &&
        value.weekdays?.join() === "1,2,3,4,5" &&
        value.interval === 1
      ? "weekdays"
      : value.frequency === "weekly" && value.interval === 2 && !value.weekdays
        ? "fortnightly"
        : value.interval === 1 &&
            !value.weekdays &&
            (!value.monthlyMode || value.monthlyMode === "date")
          ? value.frequency
          : "custom";
  let preview: string[] = [];
  let previewError = "";
  if (value && mode === "event" && date && time) {
    try {
      const occurrences = expandEventOccurrences(
        buildEventSchedule(date, time, endTime),
        value,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      preview = [
        `${occurrences.length} events`,
        ...occurrences
          .slice(0, 5)
          .map((item) =>
            new Date(item.startsAt).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          ),
        ...(occurrences.length > 5
          ? [
              `Last: ${new Date(occurrences[occurrences.length - 1].startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
            ]
          : []),
      ];
    } catch (error) {
      previewError = (error as Error).message;
    }
  }
  return (
    <View style={styles.container}>
      <Choice
        label="Repeat"
        value={custom && value ? "custom" : preset}
        dark={isDarkMode}
        options={[
          { value: "none", label: "Does not repeat" },
          { value: "daily", label: "Daily" },
          { value: "weekdays", label: "Every weekday (Mon-Fri)" },
          { value: "weekly", label: "Weekly" },
          { value: "fortnightly", label: "Every 2 weeks" },
          { value: "monthly", label: "Monthly" },
          { value: "yearly", label: "Yearly" },
          { value: "custom", label: "Custom" },
        ]}
        onChange={(selected) => {
          setCustom(selected === "custom");
          if (selected === "custom" && value) return;
          if (selected === "none") return onChange(null);
          onChange({
            frequency: ["weekdays", "fortnightly", "custom"].includes(selected)
              ? "weekly"
              : (selected as RepeatRule["frequency"]),
            interval: selected === "fortnightly" ? 2 : 1,
            ...(selected === "weekdays" ? { weekdays: [1, 2, 3, 4, 5] } : {}),
            end:
              value?.end ??
              (mode === "template"
                ? { type: "choose" }
                : { type: "count", count: 10 }),
          });
        }}
      />
      {value ? (
        <>
          <Text style={[styles.label, { color }]}>Repeat every</Text>
          <KeyboardAwareDrawerTextInput
            accessibilityLabel="Repeat every"
            keyboardType="number-pad"
            value={value.interval ? String(value.interval) : ""}
            onChangeText={(text) =>
              onChange({ ...value, interval: Number(text) })
            }
            style={inputStyle}
          />
          <Choice
            label="Frequency"
            dark={isDarkMode}
            value={value.frequency}
            options={[
              { value: "daily", label: "Days" },
              { value: "weekly", label: "Weeks" },
              { value: "monthly", label: "Months" },
              { value: "yearly", label: "Years" },
            ]}
            onChange={(frequency) =>
              onChange({
                ...value,
                frequency: frequency as RepeatRule["frequency"],
                weekdays: undefined,
              })
            }
          />
          {value.frequency === "weekly" ? (
            <>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !value.weekdays }}
                style={styles.option}
                onPress={() =>
                  onChange({
                    ...value,
                    weekdays: value.weekdays
                      ? undefined
                      : [date ? new Date(`${date}T12:00:00`).getDay() : 1],
                  })
                }
              >
                <MaterialIcons
                  name={
                    !value.weekdays ? "check-box" : "check-box-outline-blank"
                  }
                  size={24}
                  color="#0EC3C9"
                />
                <Text style={[styles.value, { color }]}>
                  On the event's starting weekday
                </Text>
              </Pressable>
              {value.weekdays ? (
                <View style={styles.days}>
                  {WEEKDAYS.map((day, index) => (
                    <Pressable
                      key={day}
                      accessibilityRole="checkbox"
                      accessibilityLabel={day}
                      accessibilityState={{
                        checked: value.weekdays!.includes(index),
                      }}
                      style={styles.option}
                      onPress={() =>
                        onChange({
                          ...value,
                          weekdays: value.weekdays!.includes(index)
                            ? value.weekdays!.filter((item) => item !== index)
                            : [...value.weekdays!, index].sort(),
                        })
                      }
                    >
                      <MaterialIcons
                        name={
                          value.weekdays!.includes(index)
                            ? "check-box"
                            : "check-box-outline-blank"
                        }
                        size={24}
                        color="#0EC3C9"
                      />
                      <Text style={{ color }}>{day.slice(0, 3)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
          {value.frequency === "monthly" ? (
            <Choice
              label="Monthly pattern"
              dark={isDarkMode}
              value={value.monthlyMode ?? "date"}
              options={[
                { value: "date", label: "Same day of the month" },
                {
                  value: "weekday",
                  label: "Same weekday and week of the month",
                },
                {
                  value: "last-weekday",
                  label: "Last matching weekday of the month",
                },
              ]}
              onChange={(monthlyMode) =>
                onChange({
                  ...value,
                  monthlyMode: monthlyMode as RepeatRule["monthlyMode"],
                })
              }
            />
          ) : null}
          <Choice
            label="End repeat"
            dark={isDarkMode}
            value={value.end.type}
            options={[
              ...(mode === "template"
                ? [{ value: "choose", label: "Choose when creating an event" }]
                : [{ value: "date", label: "On date" }]),
              { value: "count", label: "After a number of occurrences" },
            ]}
            onChange={(ending) =>
              onChange({
                ...value,
                end:
                  ending === "choose"
                    ? { type: "choose" }
                    : ending === "date"
                      ? { type: "date", date }
                      : { type: "count", count: 10 },
              })
            }
          />
          {value.end.type === "count" ? (
            <>
              <Text style={[styles.label, { color }]}>
                Total occurrences (including first)
              </Text>
              <KeyboardAwareDrawerTextInput
                accessibilityLabel="Total occurrences (including first)"
                keyboardType="number-pad"
                value={value.end.count ? String(value.end.count) : ""}
                onChangeText={(text) =>
                  onChange({
                    ...value,
                    end: { type: "count", count: Number(text) },
                  })
                }
                style={inputStyle}
              />
            </>
          ) : null}
          {value.end.type === "date" && mode === "event" ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Repeat through"
                onPress={() => {
                  Keyboard.dismiss();
                  setDatePicker(!datePicker);
                }}
                style={inputStyle}
              >
                <Text style={[styles.value, { color }]}>
                  {value.end.date || "Repeat through"}
                </Text>
                <MaterialIcons
                  name="calendar-month"
                  color="#0EC3C9"
                  size={24}
                />
              </Pressable>
              {datePicker ? (
                <>
                  <DateTimePicker
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "default"}
                    themeVariant={isDarkMode ? "dark" : "light"}
                    value={
                      new Date(
                        `${value.end.date || date || new Date().toISOString().slice(0, 10)}T12:00:00`,
                      )
                    }
                    onChange={(event, selected) => {
                      if (
                        Platform.OS === "android" ||
                        event.type === "dismissed"
                      )
                        setDatePicker(false);
                      if (event.type === "set" && selected)
                        onChange({
                          ...value,
                          end: {
                            type: "date",
                            date: `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`,
                          },
                        });
                    }}
                  />
                  {Platform.OS === "ios" ? (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.option}
                      onPress={() => setDatePicker(false)}
                    >
                      <Text style={{ color: "#0EC3C9", fontWeight: "700" }}>
                        Done
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          <Text style={{ color }}>{describeRepeat(value)}</Text>
          {preview.map((line, index) => (
            <Text key={index} style={{ color }}>
              {line}
            </Text>
          ))}
          {previewError ? (
            <Text
              accessibilityRole="alert"
              style={{ color: isDarkMode ? "#FFACA5" : "#B91C1C" }}
            >
              {previewError}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, marginVertical: 16 },
  field: { gap: 8 },
  label: { fontSize: 16, fontWeight: "700" },
  value: { fontSize: 16, flexShrink: 1 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#94A3B8",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  days: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
