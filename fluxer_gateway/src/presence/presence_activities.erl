%% SPDX-License-Identifier: AGPL-3.0-or-later

-module(presence_activities).
-typing([eqwalizer]).

-export([normalize/1]).

-define(MAX_ACTIVITIES, 10).
-define(MAX_TEXT_LENGTH, 128).
-define(MAX_IMAGE_LENGTH, 256).
-define(MAX_SNOWFLAKE_BYTES, 19).
-define(MAX_TIMESTAMP, 9007199254740991).

%% Only inspect the first ten entries, including invalid ones, to bound work on client input.
%% Callers distinguish an omitted update from an explicit clear before normalizing.
-spec normalize(term()) -> [map()].
normalize(Activities) ->
    normalize_entries(Activities, ?MAX_ACTIVITIES, []).

-spec normalize_entries(term(), non_neg_integer(), [map()]) -> [map()].
normalize_entries(_Activities, 0, Acc) ->
    lists:reverse(Acc);
normalize_entries([Activity | Rest], Remaining, Acc) ->
    case normalize_activity(Activity) of
        undefined -> normalize_entries(Rest, Remaining - 1, Acc);
        Normalized -> normalize_entries(Rest, Remaining - 1, [Normalized | Acc])
    end;
normalize_entries(_Activities, _Remaining, Acc) ->
    lists:reverse(Acc).

-spec normalize_activity(term()) -> map() | undefined.
normalize_activity(#{<<"name">> := Name, <<"type">> := Type} = Activity) when
    is_integer(Type), Type >= 0, Type =< 5
->
    case normalize_text(Name) of
        undefined -> undefined;
        <<>> -> undefined;
        Text -> normalize_activity_fields(Activity, #{<<"name">> => Text, <<"type">> => Type})
    end;
normalize_activity(_) ->
    undefined.

-spec normalize_activity_fields(map(), map()) -> map().
normalize_activity_fields(Activity, Base) ->
    put_optional_fields(
        [
            {<<"application_id">>,
                normalize_application_id(maps:get(<<"application_id">>, Activity, undefined))},
            {<<"details">>, normalize_text(maps:get(<<"details">>, Activity, undefined))},
            {<<"state">>, normalize_text(maps:get(<<"state">>, Activity, undefined))},
            {<<"timestamps">>,
                normalize_timestamps(maps:get(<<"timestamps">>, Activity, undefined))},
            {<<"assets">>, normalize_assets(maps:get(<<"assets">>, Activity, undefined))}
        ],
        Base
    ).

-spec put_optional_fields([{binary(), term()}], map()) -> map().
put_optional_fields([], Acc) ->
    Acc;
put_optional_fields([{_Key, undefined} | Rest], Acc) ->
    put_optional_fields(Rest, Acc);
put_optional_fields([{Key, Value} | Rest], Acc) ->
    put_optional_fields(Rest, Acc#{Key => Value}).

-spec normalize_text(term()) -> binary() | undefined.
normalize_text(Value) ->
    normalize_text(Value, ?MAX_TEXT_LENGTH).

%% Copy retained strings so a small activity cannot keep its entire decoded frame alive.
-spec normalize_text(term(), pos_integer()) -> binary() | undefined.
normalize_text(Value, MaxLength) when is_binary(Value), byte_size(Value) =< MaxLength * 4 ->
    case valid_utf16_length(Value, MaxLength) of
        true -> binary:copy(Value);
        false -> undefined
    end;
normalize_text(_Value, _MaxLength) ->
    undefined.

%% Match the client schema's JavaScript string length without allocating a character list.
%% UTF-8 matching also rejects malformed encodings; supplementary characters use two units.
-spec valid_utf16_length(binary(), non_neg_integer()) -> boolean().
valid_utf16_length(<<>>, _Remaining) ->
    true;
valid_utf16_length(<<Codepoint/utf8, Rest/binary>>, Remaining) when
    Codepoint =< 16#FFFF, Remaining >= 1
->
    valid_utf16_length(Rest, Remaining - 1);
valid_utf16_length(<<Codepoint/utf8, Rest/binary>>, Remaining) when
    Codepoint > 16#FFFF, Remaining >= 2
->
    valid_utf16_length(Rest, Remaining - 2);
valid_utf16_length(_Value, _Remaining) ->
    false.

-spec normalize_application_id(term()) -> binary() | undefined.
normalize_application_id(Value) when
    is_binary(Value), byte_size(Value) > 0, byte_size(Value) =< ?MAX_SNOWFLAKE_BYTES
->
    case snowflake_id:parse_maybe(Value) of
        undefined -> undefined;
        _Id -> binary:copy(Value)
    end;
normalize_application_id(_) ->
    undefined.

-spec normalize_timestamps(term()) -> map() | undefined.
normalize_timestamps(Timestamps) when is_map(Timestamps) ->
    optional_map(
        put_optional_fields(
            [
                {<<"start">>, normalize_timestamp(maps:get(<<"start">>, Timestamps, undefined))},
                {<<"end">>, normalize_timestamp(maps:get(<<"end">>, Timestamps, undefined))}
            ],
            #{}
        )
    );
normalize_timestamps(_) ->
    undefined.

%% Preserve the client's integer timestamp value; the Gateway does not convert time units.
-spec normalize_timestamp(term()) -> non_neg_integer() | undefined.
normalize_timestamp(Value) when is_integer(Value), Value >= 0, Value =< ?MAX_TIMESTAMP ->
    Value;
normalize_timestamp(_) ->
    undefined.

-spec normalize_assets(term()) -> map() | undefined.
normalize_assets(Assets) when is_map(Assets) ->
    optional_map(
        put_optional_fields(
            [
                {<<"large_image">>,
                    normalize_image(maps:get(<<"large_image">>, Assets, undefined))},
                {<<"large_text">>, normalize_text(maps:get(<<"large_text">>, Assets, undefined))},
                {<<"small_image">>,
                    normalize_image(maps:get(<<"small_image">>, Assets, undefined))},
                {<<"small_text">>, normalize_text(maps:get(<<"small_text">>, Assets, undefined))}
            ],
            #{}
        )
    );
normalize_assets(_) ->
    undefined.

-spec normalize_image(term()) -> binary() | undefined.
normalize_image(Value) ->
    case normalize_text(Value, ?MAX_IMAGE_LENGTH) of
        <<"data:", _/binary>> -> undefined;
        <<"blob:", _/binary>> -> undefined;
        <<"fluxer-rpc-art://", _/binary>> -> undefined;
        Image -> Image
    end.

-spec optional_map(map()) -> map() | undefined.
optional_map(Map) when map_size(Map) =:= 0 ->
    undefined;
optional_map(Map) ->
    Map.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

normalize_clears_missing_null_and_invalid_input_test() ->
    [?assertEqual([], normalize(Value)) || Value <- [undefined, null, [], #{}, <<"bad">>, 1]],
    ?assertEqual([], normalize([null, undefined, #{}])).

normalize_preserves_documented_fields_test() ->
    Activity = #{
        <<"name">> => <<"Game">>,
        <<"type">> => 0,
        <<"application_id">> => <<"123456789">>,
        <<"details">> => <<"In a match">>,
        <<"state">> => <<"Playing">>,
        <<"timestamps">> => #{<<"start">> => 1791081018, <<"end">> => 1791084618},
        <<"assets">> => #{
            <<"large_image">> => <<"https://cdn.example.org/game.png">>,
            <<"large_text">> => <<"Game art">>,
            <<"small_image">> => <<"mp:external/game-icon">>,
            <<"small_text">> => <<"Icon">>
        }
    },
    ?assertEqual([Activity], normalize([Activity])),
    Activities = [#{<<"name">> => <<"Activity">>, <<"type">> => Type} || Type <- lists:seq(0, 5)],
    ?assertEqual(Activities, normalize(Activities)).

normalize_requires_name_and_integer_type_test() ->
    Invalid = [
        #{<<"name">> => <<"Game">>},
        #{<<"type">> => 0},
        #{<<"name">> => <<>>, <<"type">> => 0},
        #{<<"name">> => null, <<"type">> => 0},
        #{<<"name">> => <<"Game">>, <<"type">> => -1},
        #{<<"name">> => <<"Game">>, <<"type">> => 6},
        #{<<"name">> => <<"Game">>, <<"type">> => 0.0},
        #{name => <<"Game">>, type => 0}
    ],
    ?assertEqual([], normalize(Invalid)).

normalize_bounds_entry_processing_test() ->
    Activities = [#{<<"name">> => integer_to_binary(I), <<"type">> => 0} || I <- lists:seq(1, 11)],
    ?assertEqual(lists:sublist(Activities, 10), normalize(Activities)),
    ?assertEqual([], normalize(lists:duplicate(10, null) ++ [test_activity()])).

normalize_uses_utf16_text_limits_test() ->
    Activity = test_activity(),
    Latin = binary:copy(<<16#E9/utf8>>, 128),
    Astral = binary:copy(<<16#1F3AE/utf8>>, 64),
    [?assertEqual([Activity#{<<"name">> => Name}], normalize([Activity#{<<"name">> => Name}])) ||
        Name <- [Latin, Astral]],
    [?assertEqual([], normalize([Activity#{<<"name">> => Name}])) ||
        Name <- [<<Latin/binary, "a">>, <<Astral/binary, "a">>, <<255>>, <<16#C3>>]],
    ?assertEqual([Activity], normalize([Activity#{<<"details">> => binary:copy(<<"x">>, 129)}])).

normalize_detaches_retained_binaries_test() ->
    Frame = binary:copy(<<"1">>, 4096),
    Name = binary:part(Frame, 0, 128),
    Id = binary:part(Frame, 0, 19),
    Input = #{<<"name">> => Name, <<"type">> => 0, <<"application_id">> => Id},
    [Activity] = normalize([Input]),
    ?assertEqual(Input, Activity),
    ?assertEqual(128, binary:referenced_byte_size(maps:get(<<"name">>, Activity))),
    ?assertEqual(19, binary:referenced_byte_size(maps:get(<<"application_id">>, Activity))).

normalize_omits_invalid_optional_values_test() ->
    Activity = test_activity(),
    Input = Activity#{
        <<"application_id">> => 123,
        <<"details">> => #{<<"private">> => true},
        <<"state">> => null,
        <<"timestamps">> => [],
        <<"assets">> => <<"bad">>
    },
    ?assertEqual([Activity], normalize([Input])).

normalize_strips_unknown_fields_at_each_level_test() ->
    Activity = test_activity(),
    Input = Activity#{
        <<"metadata">> => #{<<"token">> => <<"private">>},
        <<"url">> => <<"https://private.example.org">>,
        <<"timestamps">> => #{<<"start">> => 123, <<"private">> => <<"secret">>},
        <<"assets">> => #{<<"large_text">> => <<"Art">>, <<"local_path">> => <<"private">>}
    },
    Expected = Activity#{
        <<"timestamps">> => #{<<"start">> => 123},
        <<"assets">> => #{<<"large_text">> => <<"Art">>}
    },
    ?assertEqual([Expected], normalize([Input])).

normalize_timestamp_bounds_test() ->
    Activity = test_activity(),
    Valid = Activity#{<<"timestamps">> => #{<<"start">> => 0, <<"end">> => ?MAX_TIMESTAMP}},
    ?assertEqual([Valid], normalize([Valid])),
    [
        ?assertEqual(
            [Activity], normalize([Activity#{<<"timestamps">> => #{<<"start">> => Value}}])
        )
     || Value <- [-1, ?MAX_TIMESTAMP + 1, 1.5, <<"123">>, null]
    ],
    ?assertEqual([Activity], normalize([Activity#{<<"timestamps">> => #{}}])).

normalize_application_id_bounds_test() ->
    Activity = test_activity(),
    Valid = Activity#{<<"application_id">> => <<"9223372036854775807">>},
    ?assertEqual([Valid], normalize([Valid])),
    [?assertEqual([Activity], normalize([Activity#{<<"application_id">> => Id}])) ||
        Id <- [<<"0">>, <<"001">>, <<"9223372036854775808">>, binary:copy(<<"9">>, 20)]].

normalize_removes_local_asset_references_test() ->
    Activity = test_activity(),
    [
        ?assertEqual(
            [Activity], normalize([Activity#{<<"assets">> => #{<<"large_image">> => Image}}])
        )
     || Image <- [<<"data:image/png;base64,AAAA">>, <<"blob:local">>, <<"fluxer-rpc-art://local">>]
    ],
    Image = binary:copy(<<16#E9/utf8>>, 256),
    Valid = Activity#{<<"assets">> => #{<<"small_image">> => Image}},
    ?assertEqual([Valid], normalize([Valid])),
    TooLong = Activity#{<<"assets">> => #{<<"small_image">> => <<Image/binary, "a">>}},
    ?assertEqual([Activity], normalize([TooLong])).

test_activity() ->
    #{<<"name">> => <<"Game">>, <<"type">> => 0}.

-endif.
